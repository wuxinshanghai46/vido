const confirmations = require('./referenceUnderstandingConfirmationService');

function project(taskId, context = {}, analysis = {}) {
  return {
    reference_understanding: analysis.reference_understanding && typeof analysis.reference_understanding === 'object'
      ? analysis.reference_understanding
      : null,
    understanding_confirmation: confirmations.inspect(taskId, context),
  };
}

module.exports = { project };
