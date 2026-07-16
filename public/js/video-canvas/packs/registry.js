export const PACKS = {
  blank:{label:'自由画布',icon:'＋',accent:'#5367f8'},ecommerce:{label:'电商广告',icon:'🛍',accent:'#ff8a4c'},story:{label:'故事剧情',icon:'🎭',accent:'#8b5cf6'},'social-ad':{label:'社媒广告',icon:'📱',accent:'#ec4899'},'product-demo':{label:'产品演示',icon:'🧭',accent:'#14b8a6'},
};
export function packInfo(id){return PACKS[id]||PACKS.blank}
