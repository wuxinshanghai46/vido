export function conversationNearBottom(conversation, threshold = 72) {
  if (!conversation) return false;
  return Number(conversation.scrollHeight || 0) - Number(conversation.scrollTop || 0) - Number(conversation.clientHeight || 0) <= threshold;
}

export function followConversationAfter(conversation, mutate, { force = false } = {}) {
  const follow = force || conversationNearBottom(conversation);
  const result = mutate();
  if (follow && conversation) conversation.scrollTop = conversation.scrollHeight;
  return result;
}
