'use strict';

const DEFAULT_DEPENDENCIES = Object.freeze({
  brief: [],
  subjects: ['brief'],
  scenes: ['brief', 'subjects'],
  blueprint: ['brief', 'subjects', 'scenes'],
  storyboard: ['blueprint', 'subjects', 'scenes'],
  audio: ['storyboard'],
  video: ['storyboard', 'subjects', 'scenes'],
  compose: ['audio', 'video', 'storyboard'],
});

function downstreamGraph(dependencies = DEFAULT_DEPENDENCIES) {
  const downstream = Object.fromEntries(Object.keys(dependencies).map(key => [key, []]));
  Object.entries(dependencies).forEach(([node, upstream]) => {
    (Array.isArray(upstream) ? upstream : []).forEach(parent => {
      if (!downstream[parent]) downstream[parent] = [];
      downstream[parent].push(node);
    });
  });
  return downstream;
}

function affectedDomains(changed = [], dependencies = DEFAULT_DEPENDENCIES) {
  const direct = [...new Set((Array.isArray(changed) ? changed : [changed]).filter(Boolean))];
  const graph = downstreamGraph(dependencies);
  const affected = new Set();
  const queue = [...direct];
  while (queue.length) {
    const current = queue.shift();
    (graph[current] || []).forEach(next => {
      if (direct.includes(next) || affected.has(next)) return;
      affected.add(next);
      queue.push(next);
    });
  }
  return { changed: direct, invalidated: [...affected] };
}

module.exports = { DEFAULT_DEPENDENCIES, affectedDomains, downstreamGraph };
