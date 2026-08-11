const { AsyncLocalStorage } = require('async_hooks');
const surveyContext = new AsyncLocalStorage();
module.exports = { surveyContext };
