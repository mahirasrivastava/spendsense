// Netlify Function wrapper: runs the Express app as a serverless handler.
const serverless = require('serverless-http');
const { app, init } = require('../../server');

const PREFIX = '/.netlify/functions/api';
let wrapped;

exports.handler = async (event, context) => {
  // Keeps the Neon pool alive between invocations instead of waiting for the
  // event loop to drain on every request.
  context.callbackWaitsForEmptyEventLoop = false;

  // The catch-all redirect leaves the function prefix on the path; Express
  // needs the original route.
  if (event.path && event.path.startsWith(PREFIX)) {
    event.path = event.path.slice(PREFIX.length) || '/';
  }

  await init();                       // schema + seed, memoised per container
  if (!wrapped) wrapped = serverless(app);
  return wrapped(event, context);
};
