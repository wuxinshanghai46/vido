import { escapeHtml, setButtonBusy, toast } from '../components/ui.js';
import { confirmDialog, promptDialog } from '../components/dialog.js';

const MATERIALS = [
  ['reference', '参考视频', '上传视频或粘贴公开链接'],
  ['product', '商品 / 主体', '上传商品或服务主体图片'],
  ['person', '人物 / 宠物', '上传身份参考，或进入资产中心生成'],
  ['scene', '场景 / 空间', '上传环境参考图片'],
  ['logo', '品牌标识', '仅使用已经授权的图片文件'],
  ['script', '脚本 / 分镜', '上传文本文件或直接写入目标'],
];

/** 从表单生成现有任务接口可以接受的请求。 */
function formPayload(form) {
  const data = new FormData(form);
  const brief = String(data.get('brief') || '').trim();
  return {
    project_name: String(data.get('project_name') || '').trim(),
    brief,
    content: brief,
    product_subject: String(data.get('product_subject') || '').trim(),
    target_duration: Number(data.get('target_duration') || 30) || 30,
    output_ratio: String(data.get('output_ratio') || '9:16'),
    output_size: String(data.get('output_size') || 'standard'),
    video_resolution: String(data.get('video_resolution') || '720p'),
    cast_mode: String(data.get('cast_mode') || 'auto'),
    expected_people: Math.max(0, Number(data.get('expected_people') || 0) || 0),
    expected_animals: Math.max(0, Number(data.get('expected_animals') || 0) || 0),
    production_mode: String(data.get('production_mode') || 'auto'),
  };
}

/** 输出真实材料当前状态。 */
function materialRows(bundle, isNew) {
  const reference = bundle?.reference || {};
  const assets = bundle?.assets || {};
  const ready = {
    reference: !!(reference.analysis_id || reference.filename || reference.url),
    product: !!assets.products?.length,
    person: !!(assets.people?.length || assets.animals?.length),
    scene: !!(assets.scenes?.length || bundle?.materials?.roles?.includes('scene_reference')),
    logo: !!assets.logos?.length,
    script: !!bundle?.story?.blueprint,
  };
  return MATERIALS.map(([id, label, hint]) => `
    <div class="material-row ${ready[id] ? 'is-ready' : ''}" data-material-row="${id}">
      <span><b>${escapeHtml(label)}</b><small>${ready[id] ? '已连接当前项目内容' : escapeHtml(hint)}</small></span>
      <span class="material-actions">
        ${id === 'reference' ? '<button class="btn" type="button" data-reference-link>粘贴链接</button>' : ''}
        <button class="btn" type="button" data-material-upload="${id}">${isNew ? '创建并添加' : (ready[id] ? '更换' : '添加')}</button>
      </span>
    </div>`).join('');
}

/** 挂载目标与材料页。 */
export async function mount(host, context) {
  const { route, store, navigate } = context;
  const bundle = store.state.bundle || {};
  const brief = bundle.brief || {};
  host.innerHTML = `
    <section class="view-head">
      <div><h1>先说清楚要做什么</h1><p>只写一句话也可以建立项目；参考视频、人物、商品、场景和脚本都不是创建前提。</p></div>
      ${!route.isNew ? '<span class="status-tag is-success">自动保存到真实任务</span>' : ''}
    </section>
    <div class="guide"><b>操作方法</b>　①填写目标　②按需添加材料　③保存后进入资产中心</div>
    <div class="two-column">
      <form class="card brief-form" data-brief-form>
        <div class="card-head"><div><h2>这支剧情广告要讲什么？</h2><p>写清产品或主题、受众、情绪以及观众需要记住的内容。</p></div></div>
        <div class="card-body form-grid">
          <label class="field full"><span>项目名称</span><input class="input" name="project_name" required minlength="2" maxlength="120" value="${escapeHtml(brief.project_name || bundle.project?.title || '')}" placeholder="例如：新标门窗 · 全景窗剧情广告"><small>由你命名，只用于项目识别；修改广告目标不会再自动改名。</small></label>
          <label class="field full"><span>广告目标</span><textarea class="textarea" name="brief" rows="7" required minlength="8" placeholder="例如：为某个产品制作一支剧情广告，说明人物、场景、情绪和品牌目标。">${escapeHtml(brief.text || '')}</textarea></label>
          <label class="field"><span>产品或主题</span><input class="input" name="product_subject" value="${escapeHtml(brief.product_subject || '')}" placeholder="没有商品也可以留空"></label>
          <label class="field"><span>目标时长</span><select class="select" name="target_duration">
            ${[15, 30, 45, 60].map(value => `<option value="${value}" ${Number(brief.target_duration || 30) === value ? 'selected' : ''}>${value} 秒</option>`).join('')}
          </select></label>
          <label class="field"><span>画面比例</span><select class="select" name="output_ratio">
            ${['9:16', '16:9', '1:1'].map(value => `<option ${brief.output_ratio === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select></label>
          <label class="field"><span>视频分辨率</span><select class="select" name="video_resolution">
            ${['720p', '1080p', '4K'].map(value => `<option ${brief.video_resolution === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select></label>
          <label class="field"><span>人物模式</span><select class="select" name="cast_mode">
            <option value="auto" ${brief.cast_mode === 'auto' ? 'selected' : ''}>按需求判断</option>
            <option value="single" ${brief.cast_mode === 'single' ? 'selected' : ''}>单人</option>
            <option value="dual" ${brief.cast_mode === 'dual' ? 'selected' : ''}>双人</option>
            <option value="multi" ${brief.cast_mode === 'multi' ? 'selected' : ''}>多人</option>
            <option value="human_pet" ${brief.cast_mode === 'human_pet' ? 'selected' : ''}>人物与宠物</option>
            <option value="animal" ${brief.cast_mode === 'animal' ? 'selected' : ''}>仅动物</option>
            <option value="no_human" ${brief.cast_mode === 'no_human' ? 'selected' : ''}>无人物</option>
          </select></label>
          <label class="field"><span>人物数量</span><input class="input" type="number" min="0" max="12" name="expected_people" value="${Number(brief.expected_people) || 0}"></label>
          <label class="field"><span>动物数量</span><input class="input" type="number" min="0" max="12" name="expected_animals" value="${Number(brief.expected_animals) || 0}"></label>
          <div class="field full form-actions"><button class="btn primary" type="submit">${route.isNew ? '创建项目' : '保存目标'}</button></div>
        </div>
      </form>
      <aside class="card">
        <div class="card-head"><div><h2>补充材料</h2><p>全部可选，只在确实需要时添加。</p></div></div>
        <div class="card-body material-list">${materialRows(bundle, route.isNew)}</div>
      </aside>
    </div>
    ${bundle.reference?.analysis_id ? `<section class="card reference-summary">
      <div class="card-head"><div><h2>参考内容分析</h2><p>${escapeHtml(bundle.reference.filename || '当前参考视频')} · ${escapeHtml(bundle.reference.status || '等待分析')}</p></div></div>
      <div class="card-body">
        ${bundle.reference.error ? `<div class="inline-error">${escapeHtml(bundle.reference.error)}</div>` : ''}
        <div class="reference-facts">
          <div><span>识别主体</span><p>${escapeHtml(bundle.reference.source_facts?.product_or_service || (bundle.reference.status === 'completed' ? '未提取到明确主体' : '分析完成后显示'))}</p></div>
          <div><span>内容环境</span><p>${escapeHtml(bundle.reference.source_facts?.environment || (bundle.reference.status === 'completed' ? '未提取到明确环境' : '分析完成后显示'))}</p></div>
          <div class="full"><span>人物与行为</span><p>${escapeHtml(bundle.reference.source_facts?.human_actions?.join('；') || (bundle.reference.source_facts?.human_presence === false ? '未发现人物出镜' : '分析完成后显示'))}</p></div>
          ${bundle.reference.generated_brief ? `<div class="full"><span>参考内容摘要</span><p>${escapeHtml(bundle.reference.generated_brief)}</p></div>` : ''}
        </div>
      </div>
    </section>` : ''}
    ${MATERIALS.map(([id]) => `<input class="hidden-input" hidden type="file" data-material-file="${id}" ${id === 'reference' ? 'accept="video/mp4,video/quicktime,video/webm"' : (id === 'script' ? 'accept=".txt,.md,text/plain,text/markdown"' : 'accept="image/png,image/jpeg,image/webp"')}>`).join('')}`;

  const form = host.querySelector('[data-brief-form]');
  let createdProjectId = route.isNew ? '' : bundle.project?.id;

  /** 新建模式下先建立真实任务，后续材料全部绑定该任务。 */
  async function ensureProject(button) {
    if (createdProjectId) return createdProjectId;
    const payload = formPayload(form);
    if (payload.project_name.length < 2) throw new Error('请先填写至少 2 个字的项目名称。');
    if (payload.brief.length < 8) throw new Error('请先填写至少 8 个字的广告目标。');
    setButtonBusy(button, true, '正在创建…');
    const project = await store.createProject(payload);
    createdProjectId = project.id;
    await store.loadBundle(createdProjectId, 'all');
    return createdProjectId;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    try {
      if (route.isNew) {
        const taskId = await ensureProject(button);
        toast('项目已创建。', 'success');
        navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
      } else {
        setButtonBusy(button, true, '保存中…');
        await store.updateRequest(formPayload(form));
        toast('目标已保存。', 'success');
        setButtonBusy(button, false);
      }
    } catch (error) {
      setButtonBusy(button, false);
      toast(error.message, 'danger');
    }
  });

  host.querySelectorAll('[data-material-upload]').forEach(button => {
    button.addEventListener('click', () => host.querySelector(`[data-material-file="${button.dataset.materialUpload}"]`)?.click());
  });

  host.querySelectorAll('[data-material-file]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const role = input.dataset.materialFile;
      const button = host.querySelector(`[data-material-upload="${role}"]`);
      try {
        if (role === 'reference' && !await confirmDialog('请确认你拥有该视频的分析与使用权。确认后开始上传和分析。', {
          title: '参考视频授权确认',
          confirmText: '确认并开始分析',
        })) {
          input.value = '';
          return;
        }
        const taskId = await ensureProject(button);
        if (role === 'reference') {
          setButtonBusy(button, true, '上传视频…');
          await store.uploadReference(file);
        } else if (role === 'script') {
          const text = await file.text();
          if (!text.trim()) throw new Error('脚本文本为空。');
          const current = formPayload(form);
          await store.updateRequest({
            ...current,
            creative_direction: { raw: text.slice(0, 12000), source_name: file.name },
          });
        } else {
          setButtonBusy(button, true, '上传中…');
          const uploaded = await store.upload(file, role === 'logo' ? 'brand_logo' : `${role}_reference`);
          const asset = uploaded.asset || uploaded.data;
          await store.attachMaterial(role, asset, { authorized: role === 'logo' });
        }
        toast('材料已添加到当前项目。', 'success');
        if (route.isNew) navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
        else {
          await store.loadBundle(taskId, 'all');
          await context.refreshShell();
        }
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
        input.value = '';
      }
    });
  });

  host.querySelector('[data-reference-link]')?.addEventListener('click', async event => {
    const url = await promptDialog('添加参考链接', {
      message: '粘贴无需登录即可访问的公开视频链接。',
      inputLabel: '参考视频链接',
      placeholder: 'https://',
      confirmText: '继续',
    });
    if (!url) return;
    if (!await confirmDialog('请确认你拥有该链接视频的分析与使用权。确认后开始读取。', {
      title: '参考视频授权确认',
      confirmText: '确认并开始读取',
    })) return;
    const button = event.currentTarget;
    try {
      const taskId = await ensureProject(button);
      setButtonBusy(button, true, '正在添加…');
      await store.addReferenceLink(url);
      toast('参考链接已添加，分析将在后台进行。', 'success');
      if (route.isNew) navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`, { replace: true });
      else await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
