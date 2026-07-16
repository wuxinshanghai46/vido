import { nodeUi } from '../nodes/registry.js';

export class VideoCanvasEditor {
  constructor({wrap,stage,nodeLayer,edgeLayer,catalog,onChange,onSelect,onConnection}) {
    Object.assign(this,{wrap,stage,nodeLayer,edgeLayer,catalog,onChange,onSelect,onConnection});
    this.graph={schemaVersion:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}};this.selected='';this.pending=null;this.connectionGesture=null;this.previewPoint=null;this.zoom=1;this.drag=null;
    this.bind();
  }
  bind(){
    document.addEventListener('pointermove',e=>{if(!this.moveConnection(e))this.move(e)});document.addEventListener('pointerup',e=>{if(!this.endConnectionGesture(e))this.endDrag()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancelConnection();if((e.key==='Delete'||e.key==='Backspace')&&this.selected&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();this.removeNode(this.selected)}});
  }
  setGraph(graph){
    this.graph={schemaVersion:Number(graph?.schemaVersion)||1,nodes:(graph?.nodes||[]).map(n=>({...n,config:{...(n.config||{})},position:{x:Number(n.position?.x)||0,y:Number(n.position?.y)||0}})),edges:(graph?.edges||[]).map(e=>({...e})),viewport:graph?.viewport||{x:0,y:0,zoom:1}};
    this.zoom=Math.max(.4,Math.min(1.6,Number(this.graph.viewport.zoom)||1));this.render();
  }
  getGraph(){return JSON.parse(JSON.stringify({...this.graph,viewport:{...this.graph.viewport,zoom:this.zoom}}))}
  addNode(type,config={},position){
    const manifest=this.catalog[type];if(!manifest)return null;const id=`node_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const count=this.graph.nodes.length;const node={id,type,version:manifest.version||1,label:manifest.label,config:{...config},position:position||{x:80+(count%4)*270,y:70+Math.floor(count/4)*210}};
    this.graph.nodes.push(node);this.selected=id;this.render();this.changed('node.added');this.onSelect?.(node);return node;
  }
  removeNode(id){
    const before=this.graph.nodes.length;this.graph.nodes=this.graph.nodes.filter(n=>n.id!==id);this.graph.edges=this.graph.edges.filter(e=>e.source!==id&&e.target!==id);if(before===this.graph.nodes.length)return;
    if(this.selected===id){this.selected='';this.onSelect?.(null)}this.render();this.changed('node.removed');
  }
  updateNode(id,patch){const node=this.node(id);if(!node)return;Object.assign(node,patch);if(patch.config)node.config={...patch.config};this.renderNode(id);this.renderEdges();this.changed('node.updated');this.onSelect?.(node)}
  node(id){return this.graph.nodes.find(n=>n.id===id)}
  render(){this.nodeLayer.innerHTML='';for(const node of this.graph.nodes)this.nodeLayer.append(this.nodeElement(node));this.applyZoom();this.renderEdges();document.getElementById('empty-canvas')?.toggleAttribute('hidden',this.graph.nodes.length>0)}
  renderNode(id){const old=this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`);const node=this.node(id);if(old&&node)old.replaceWith(this.nodeElement(node))}
  nodeElement(node){
    const manifest=this.catalog[node.type]||{inputs:{},outputs:{},label:node.type,category:'unknown'};const ui=nodeUi(node.type);const el=document.createElement('article');el.className=`vc-node ${this.selected===node.id?'selected':''}`;el.dataset.nodeId=node.id;el.style.left=`${node.position.x}px`;el.style.top=`${node.position.y}px`;
    const runtimeStatus=node.runtimeStatus||'dirty';el.innerHTML=`<div class="vc-node-head"><i class="vc-node-icon">${ui.icon}</i><b>${escapeHtml(node.label||manifest.label)}</b><span class="vc-node-kind">${escapeHtml(manifest.category||'')}</span><span class="vc-node-state ${runtimeStatus}" title="节点状态：${escapeHtml(statusText(runtimeStatus))}" aria-label="节点状态：${escapeHtml(statusText(runtimeStatus))}"></span></div><div class="vc-node-body">${portRows(manifest,node,this.pending)}<div class="vc-node-summary">${escapeHtml(summary(node))}</div></div>`;
    el.addEventListener('click',e=>{if(e.target.closest('.vc-port'))return;this.select(node.id)});
    el.querySelector('.vc-node-head').addEventListener('pointerdown',e=>this.startDrag(e,node));
    el.querySelectorAll('.vc-port').forEach(port=>{
      port.addEventListener('click',e=>{e.stopPropagation();this.portClick(node,port.dataset.direction,port.dataset.port,port.dataset.type)});
      if(port.dataset.direction==='output')port.addEventListener('pointerdown',e=>this.prepareConnectionDrag(e,node,port.dataset.port,port.dataset.type));
    });
    return el;
  }
  select(id){this.selected=id;this.nodeLayer.querySelectorAll('.vc-node').forEach(el=>el.classList.toggle('selected',el.dataset.nodeId===id));this.onSelect?.(this.node(id))}
  startDrag(event,node){if(event.button!==0)return;this.select(node.id);this.drag={node,startX:event.clientX,startY:event.clientY,originX:node.position.x,originY:node.position.y};event.preventDefault()}
  move(event){if(!this.drag)return;const scale=this.zoom;this.drag.node.position.x=Math.round(this.drag.originX+(event.clientX-this.drag.startX)/scale);this.drag.node.position.y=Math.round(this.drag.originY+(event.clientY-this.drag.startY)/scale);const el=this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(this.drag.node.id)}"]`);if(el){el.style.left=`${this.drag.node.position.x}px`;el.style.top=`${this.drag.node.position.y}px`}this.renderEdges()}
  endDrag(){if(!this.drag)return;this.drag=null;this.changed('node.moved')}
  prepareConnectionDrag(event,node,port,type){if(event.button!==0)return;event.stopPropagation();this.connectionGesture={nodeId:node.id,port,type,startX:event.clientX,startY:event.clientY,moved:false}}
  moveConnection(event){const gesture=this.connectionGesture;if(!gesture)return false;const distance=Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY);if(!gesture.moved&&distance<5)return true;if(!gesture.moved){gesture.moved=true;this.beginConnection(this.node(gesture.nodeId),gesture.port,gesture.type)}this.previewPoint=this.stagePoint(event.clientX,event.clientY);this.renderEdges();event.preventDefault();return true}
  endConnectionGesture(event){const gesture=this.connectionGesture;if(!gesture)return false;this.connectionGesture=null;if(!gesture.moved)return false;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.vc-port.input');if(!target){this.failConnection('请将连线拖到高亮的输入端口');return true}const nodeElement=target.closest('.vc-node');const node=this.node(nodeElement?.dataset.nodeId);this.completeConnection(node,target.dataset.port,target.dataset.type);event.preventDefault();return true}
  stagePoint(clientX,clientY){const rect=this.stage.getBoundingClientRect();return{x:(clientX-rect.left)/this.zoom,y:(clientY-rect.top)/this.zoom}}
  beginConnection(node,port,type){if(!node)return;this.pending={nodeId:node.id,port,type};this.previewPoint=null;this.render();this.onConnection?.(this.pending)}
  portClick(node,direction,port,type){
    if(direction==='output'){this.beginConnection(node,port,type);return}
    if(this.pending)this.completeConnection(node,port,type);
  }
  completeConnection(node,port,type){
    const source=this.node(this.pending?.nodeId);if(!source||!node)return this.failConnection('未找到要连接的节点');
    if(source.id===node.id)return this.failConnection('节点不能连接到自身');
    if(!compatible(this.pending.type,type))return this.failConnection(`${typeLabel(this.pending.type)}不能连接到${typeLabel(type)}`);
    if(this.wouldCreateCycle(source.id,node.id))return this.failConnection('这条连线会形成循环，请调整节点顺序');
    const exact=this.graph.edges.some(e=>e.source===source.id&&e.sourcePort===this.pending.port&&e.target===node.id&&e.targetPort===port);if(exact){this.cancelConnection();return false}
    if(!this.catalog[node.type]?.policy?.multiInput)this.graph.edges=this.graph.edges.filter(e=>!(e.target===node.id&&e.targetPort===port));
    this.graph.edges.push({id:`edge_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,source:source.id,sourcePort:this.pending.port,target:node.id,targetPort:port});
    this.pending=null;this.previewPoint=null;this.render();this.changed('edge.added');this.onConnection?.(null);return true;
  }
  wouldCreateCycle(sourceId,targetId){const queue=[targetId],seen=new Set();while(queue.length){const id=queue.shift();if(id===sourceId)return true;if(seen.has(id))continue;seen.add(id);for(const edge of this.graph.edges)if(edge.source===id)queue.push(edge.target)}return false}
  failConnection(message){this.pending=null;this.previewPoint=null;this.connectionGesture=null;this.render();this.onConnection?.({error:message});return false}
  cancelConnection(){if(!this.pending&&!this.connectionGesture&&!this.previewPoint)return;this.pending=null;this.connectionGesture=null;this.previewPoint=null;this.render();this.onConnection?.(null)}
  renderEdges(){
    this.edgeLayer.innerHTML='';for(const edge of this.graph.edges){const source=this.portPoint(edge.source,'output',edge.sourcePort),target=this.portPoint(edge.target,'input',edge.targetPort);if(source&&target)this.appendEdge(source.x,source.y,target.x,target.y,'vc-edge')}
    if(this.pending&&this.previewPoint){const source=this.portPoint(this.pending.nodeId,'output',this.pending.port);if(source)this.appendEdge(source.x,source.y,this.previewPoint.x,this.previewPoint.y,'vc-edge active preview')}
  }
  portPoint(nodeId,direction,port){const dot=this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(nodeId)}"] .vc-port.${direction}[data-port="${CSS.escape(port)}"] i`);if(!dot)return null;const rect=dot.getBoundingClientRect(),stageRect=this.stage.getBoundingClientRect();return{x:(rect.left+rect.width/2-stageRect.left)/this.zoom,y:(rect.top+rect.height/2-stageRect.top)/this.zoom}}
  appendEdge(sx,sy,tx,ty,className){const bend=Math.max(70,Math.abs(tx-sx)*.45);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class',className);path.setAttribute('d',`M ${sx} ${sy} C ${sx+bend} ${sy}, ${tx-bend} ${ty}, ${tx} ${ty}`);this.edgeLayer.append(path)}
  setZoom(value){this.zoom=Math.max(.4,Math.min(1.6,value));this.applyZoom();this.changed('viewport.zoom',false)}
  applyZoom(){this.stage.style.transform=`scale(${this.zoom})`;document.getElementById('zoom-label').textContent=`${Math.round(this.zoom*100)}%`}
  autoLayout(){const incoming=new Map(this.graph.nodes.map(n=>[n.id,[]]));for(const e of this.graph.edges)incoming.get(e.target)?.push(e.source);const depth={};const visit=id=>depth[id]??(depth[id]=Math.max(0,...(incoming.get(id)||[]).map(x=>visit(x)+1)));this.graph.nodes.forEach(n=>visit(n.id));const rows={};for(const n of this.graph.nodes){const d=depth[n.id]||0;rows[d]=(rows[d]||0)+1;n.position={x:70+d*285,y:60+(rows[d]-1)*190}}this.render();this.changed('graph.layout')}
  fit(){if(!this.graph.nodes.length)return;const maxX=Math.max(...this.graph.nodes.map(n=>n.position.x+250)),maxY=Math.max(...this.graph.nodes.map(n=>n.position.y+180));this.setZoom(Math.min(1,Math.max(.45,Math.min(this.wrap.clientWidth/maxX,this.wrap.clientHeight/maxY))))}
  changed(reason,notify=true){if(notify)this.onChange?.(this.getGraph(),reason)}
}
function portRows(manifest,node,pending){const ins=Object.entries(manifest.inputs||{}).map(([name,type])=>{const state=pending?(compatible(pending.type,type)?'available':'unavailable'):'';return `<button type="button" class="vc-port input ${state}" data-direction="input" data-port="${name}" data-type="${type}" aria-label="输入端口 ${name}（${typeLabel(type)}）"><i></i>${name}</button>`}).join('');const outs=Object.entries(manifest.outputs||{}).map(([name,type])=>`<button type="button" class="vc-port output ${pending?.nodeId===node.id&&pending?.port===name?'connecting':''}" data-direction="output" data-port="${name}" data-type="${type}" aria-label="输出端口 ${name}（${typeLabel(type)}）"><i></i>${name}</button>`).join('');return `<div class="vc-port-row"><div>${ins}</div><div>${outs}</div></div>`}
function summary(node){const c=node.config||{};return c.text||c.prompt||c.artifactId||'等待配置'}
function compatible(outType,inType){return outType==='*/*'||inType==='*/*'||outType===inType||(inType.endsWith('/*')&&outType.startsWith(inType.slice(0,-1)))}
function typeLabel(type){return({'text/plain':'文本','application/json':'结构化数据','image/*':'图片','video/*':'视频','audio/*':'音频','*/*':'任意类型'}[type]||type||'未知类型')}
function statusText(status){return({dirty:'待配置',succeeded:'成功',reused:'已复用',failed:'失败'}[status]||status||'未知')}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
