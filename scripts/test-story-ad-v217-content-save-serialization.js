'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/story-ad/store/projectStore.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '')
  .replace(/\bexport\s+/g, '');
const bundleSource = fs.readFileSync(path.join(root, 'public/story-ad/store/projectBundleStore.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '')
  .replace(/\bexport\s+/g, '');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  let serverRevision = 1;
  let serverMode = 'story';
  const putBodies = [];
  const referencePutBodies = [];
  const firstPutStarted = deferred();
  const releaseFirstPut = deferred();

  const request = async (url, options = {}) => {
    if (options.method === 'PUT') {
      putBodies.push({ ...options.body });
      if (url.includes('/tasks/task-v218')) referencePutBodies.push({ ...options.body });
      if (putBodies.length === 1) {
        firstPutStarted.resolve();
        await releaseFirstPut.promise;
      }
      assert.equal(options.body.base_content_revision, serverRevision, '每次保存必须使用服务端最新内容版本');
      serverRevision += 1;
      serverMode = options.body.content_mode || serverMode;
      return {
        task: { id: 'task-v217', content_revision: serverRevision },
        content_revision: serverRevision,
        context: {
          brief: options.body.brief || '',
          content_mode: serverMode,
          content_mode_source: 'user_selected',
        },
      };
    }
    if (url.includes('/bundle?sections=')) {
      return {
        bundle: {
          project: { id: 'task-v217', content_revision: serverRevision },
          revisions: { content: serverRevision, client_edit_seq: serverRevision - 1 },
          brief: { text: '', content_mode: serverMode, content_mode_source: 'user_selected' },
        },
      };
    }
    if (url.includes('/start') && options.method === 'POST') {
      return { analysis: { id: 'analysis-v218', status: 'running', progress: 2 } };
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  const sandbox = {
    request,
    uploadAsset: async () => {},
    uploadReferenceVideo: async () => {},
    loadProjectList: async () => [],
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(`${bundleSource}\n${source}\nglobalThis.__createProjectStore = createProjectStore;`, sandbox, {
    filename: 'public/story-ad/store/projectStore.js',
  });

  const store = sandbox.__createProjectStore();
  store.state.bundle = {
    project: { id: 'task-v217' },
    revisions: { content: 1, client_edit_seq: 0 },
    brief: { text: '', content_mode: 'story' },
  };

  const firstSave = store.updateRequest({ brief: '广告脚本', content_mode: 'commercial_subject' });
  await firstPutStarted.promise;
  const secondSave = store.updateRequest({ brief: '广告脚本（补充）', content_mode: 'commercial_subject' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(putBodies.length, 1, '第一笔保存未完成时，第二笔保存不得并发提交');

  releaseFirstPut.resolve();
  await Promise.all([firstSave, secondSave]);

  assert.deepEqual(putBodies.map(body => body.base_content_revision), [1, 2], '串行保存必须逐笔采用上一笔返回的新版本');
  assert.equal(store.state.bundle.revisions.content, 3, '客户端最终版本必须与两次服务端提交一致');
  assert.equal(store.state.bundle.brief.content_mode, 'commercial_subject', '广告类型必须立即回写到客户端权威状态');

  serverRevision = 1;
  serverMode = 'commercial_subject';
  sandbox.beginReferenceReplacement = () => ({ sequence: 1 });
  sandbox.replacementCurrent = () => true;
  sandbox.uploadReferenceVideo = async () => {
    serverRevision = 2;
    return {
      analysis: { id: 'analysis-v218', status: 'uploaded', progress: 0 },
      task_bound: true,
      task_mutation: {
        task: { id: 'task-v218', content_revision: 2 },
        content_revision: 2,
        context: { brief: '', content_mode: 'commercial_subject', content_mode_source: 'user' },
      },
    };
  };
  const uploadStore = sandbox.__createProjectStore();
  uploadStore.state.bundle = {
    project: { id: 'task-v218' },
    revisions: { content: 1, client_edit_seq: 0 },
    brief: { text: '', content_mode: 'commercial_subject', content_mode_source: 'user' },
    reference: {},
  };
  await uploadStore.uploadReference({ name: 'reference.mp4' });
  uploadStore.stopReferencePolling();
  assert.equal(referencePutBodies[0].base_content_revision, 2, '参考视频绑定后的下一笔保存必须使用回执中的版本 2');
  assert.equal(uploadStore.state.bundle.revisions.content, 3, '参考视频启动状态同步后页面必须采用最新版本 3');
  assert.equal(uploadStore.state.bundle.brief.content_mode, 'commercial_subject', '参考视频绑定不得改变广告内容域');
  console.log('story-ad v217 content save serialization regression passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
