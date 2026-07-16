const source = require('./sourceExecutor');
const text = require('./textGenerateExecutor');
const image = require('./imageGenerateExecutor');
const character = require('./characterExecutor');
const video = require('./videoGenerateExecutor');
const voice = require('./voiceExecutor');
const music = require('./musicExecutor');
const localVideo = require('./localVideoExecutor');

const EXECUTORS = new Map([
  ['text-input', source], ['image-upload', source], ['video-upload', source],
  ['text-generate', text], ['structured-text', text],
  ['image-generate', image], ['image-edit', image], ['character', character],
  ['text-to-video', video], ['image-to-video', video], ['voice', voice], ['music', music],
  ['video-trim', localVideo], ['subtitle', localVideo], ['merge', localVideo], ['select', localVideo], ['batch', localVideo], ['condition', localVideo],
]);

function getExecutor(type) {
  const executor = EXECUTORS.get(type);
  if (!executor) throw new Error(`视频画布节点尚未实现执行器：${type}`);
  return executor;
}

module.exports = { EXECUTORS, getExecutor };
