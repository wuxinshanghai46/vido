import { nodeUi } from '../nodes/registry.js';

export class VideoCanvasEditor {
  constructor({wrap,stage,nodeLayer,edgeLayer,catalog,onChange,onSelect,onConnection}) {
    Object.assign(this,{wrap,stage,nodeLayer,edgeLayer,catalog,onChange,onSelect,onConnection});
    this.graph={schemaVersion:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}};this.selected='';this.pending=null;this.zoom=1;this.drag=null;
    this.bind();
  }
  bind(){
    document.addEventListener('pointermove',e=>this.move(e));document.addEventListener('pointerup',()=>this.endDrag());
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
  render(){this.nodeLayer.innerHTML='';for(const node of this.graph.nodes)this.nodeLayer.append(this.nodeElement(node));this.renderEdges();this.applyZoom();document.getElementById('empty-canvas')?.toggleAttribute('hidden',this.graph.nodes.length>0)}
  renderNode(id){const old=this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`);const node=this.node(id);if(old&&node)old.replaceWith(this.nodeElement(node))}
  nodeElement(node){
    const manifest=this.catalog[node.type]||{inputs:{},outputs:{},label:node.type,category:'unknown'};const ui=nodeUi(node.type);const el=document.createElement('article');el.className=`vc-node ${this.selected===node.id?'selected':''}`;el.dataset.nodeId=node.id;el.style.left=`${node.position.x}px`;el.style.top=`${node.position.y}px`;
    el.innerHTML=`<div class="vc-node-head"><i class="vc-node-icon">${ui.icon}</i><b>${escapeHtml(node.label||manifest.label)}</b><span class="vc-node-kind">${escapeHtml(manifest.category||'')}</span></div><span class="vc-node-state ${node.runtimeStatus||'dirty'}"></span><div class="vc-node-body">${portRows(manifest,node,this.pending)}<div class="vc-node-summary">${escapeHtml(summary(node))}</div></div>`;
    el.addEventListener('click',e=>{if(e.target.closest('.vc-port'))return;this.select(node.id)});
    el.querySelector('.vc-node-head').addEventListener('pointerdown',e=>this.startDrag(e,node));
    el.querySelectorAll('.vc-port').forEach(port=>port.addEventListener('click',e=>{e.stopPropagation();this.portClick(node,port.dataset.direction,port.dataset.port,port.dataset.type)}));
    return el;
  }
  select(id){this.selected=id;this.nodeLayer.querySelectorAll('.vc-node').forEach(el=>el.classList.toggle('selected',el.dataset.nodeId===id));this.onSelect?.(this.node(id))}
  startDrag(event,node){if(event.button!==0)return;this.select(node.id);this.drag={node,startX:event.clientX,startY:event.clientY,originX:node.position.x,originY:node.position.y};event.preventDefault()}
  move(event){if(!this.drag)return;const scale=this.zoom;this.drag.node.position.x=Math.round(this.drag.originX+(event.clientX-this.drag.startX)/scale);this.drag.node.position.y=Math.round(this.drag.originY+(event.clientY-this.drag.startY)/scale);const el=this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(this.drag.node.id)}"]`);if(el){el.style.left=`${this.drag.node.position.x}px`;el.style.top=`${this.drag.node.position.y}px`}this.renderEdges()}
  endDrag(){if(!this.drag)return;this.drag=null;this.changed('node.moved')}
  portClick(node,direction,port,type){
    if(direction==='output'){this.pending={nodeId:node.id,port,type};this.render();this.onConnection?.(this.pending);return}
    if(!this.pending)return;const source=this.node(this.pending.nodeId);if(!source||source.id===node.id)return this.cancelConnection();
    if(!compatible(this.pending.type,type))return this.onConnection?.({error:`${this.pending.type} 不能连接到 ${type}`});
    const exists=this.graph.edges.some(e=>e.source===source.id&&e.sourcePort===this.pending.port&&e.target===node.id&&e.targetPort===port);if(!exists)this.graph.edges.push({id:`edge_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,source:source.id,sourcePort:this.pending.port,target:node.id,targetPort:port});
    this.pending=null;this.render();this.changed('edge.added');this.onConnection?.(null);
  }
  cancelConnection(){if(!this.pending)return;this.pending=null;this.render();this.onConnection?.(null)}
  renderEdges(){
    this.edgeLayer.innerHTML='';for(const edge of this.graph.edges){const s=this.node(edge.source),t=this.node(edge.target);if(!s||!t)continue;const sm=this.catalog[s.type],tm=this.catalog[t.type];const sy=s.position.y+54+Math.max(0,Object.keys(sm?.outputs||{}).indexOf(edge.sourcePort))*19;const ty=t.position.y+54+Math.max(0,Object.keys(tm?.inputs||{}).indexOf(edge.targetPort))*19;const sx=s.position.x+230,tx=t.position.x;const bend=Math.max(70,Math.abs(tx-sx)*.45);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class','vc-edge');path.setAttribute('d',`M ${sx} ${sy} C ${sx+bend} ${sy}, ${tx-bend} ${ty}, ${tx} ${ty}`);this.edgeLayer.append(path)}
  }
  setZoom(value){this.zoom=Math.max(.4,Math.min(1.6,value));this.applyZoom();this.changed('viewport.zoom',false)}
  applyZoom(){this.stage.style.transform=`scale(${this.zoom})`;document.getElementById('zoom-label').textContent=`${Math.round(this.zoom*100)}%`}
  autoLayout(){const incoming=new Map(this.graph.nodes.map(n=>[n.id,[]]));for(const e of this.graph.edges)incoming.get(e.target)?.push(e.source);const depth={};const visit=id=>depth[id]??(depth[id]=Math.max(0,...(incoming.get(id)||[]).map(x=>visit(x)+1)));this.graph.nodes.forEach(n=>visit(n.id));const rows={};for(const n of this.graph.nodes){const d=depth[n.id]||0;rows[d]=(rows[d]||0)+1;n.position={x:70+d*285,y:60+(rows[d]-1)*190}}this.render();this.changed('graph.layout')}
  fit(){if(!this.graph.nodes.length)return;const maxX=Math.max(...this.graph.nodes.map(n=>n.position.x+250)),maxY=Math.max(...this.graph.nodes.map(n=>n.position.y+180));this.setZoom(Math.min(1,Math.max(.45,Math.min(this.wrap.clientWidth/maxX,this.wrap.clientHeight/maxY))))}
  changed(reason,notify=true){if(notify)this.onChange?.(this.getGraph(),reason)}
}
function portRows(manifest,node,pending){const ins=Object.entries(manifest.inputs||{}).map(([name,type])=>`<span class="vc-port input" data-direction="input" data-port="${name}" data-type="${type}"><i></i>${name}</span>`).join('');const outs=Object.entries(manifest.outputs||{}).map(([name,type])=>`<span class="vc-port output ${pending?.nodeId===node.id&&pending?.port===name?'connecting':''}" data-direction="output" data-port="${name}" data-type="${type}"><i></i>${name}</span>`).join('');return `<div class="vc-port-row"><div>${ins}</div><div>${outs}</div></div>`}
function summary(node){const c=node.config||{};return c.text||c.prompt||c.artifactId||'等待配置'}
function compatible(outType,inType){return outType==='*/*'||inType==='*/*'||outType===inType||(inType.endsWith('/*')&&outType.startsWith(inType.slice(0,-1)))}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
