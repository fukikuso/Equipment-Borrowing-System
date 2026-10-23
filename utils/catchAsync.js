/**
 * Wraps an async Express handler so a thrown/rejected error is forwarded to
 * next(err) instead of crashing the process or leaving the request hanging.
 */
function catchAsync(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Wraps every exported function on a controller module with catchAsync. */
function wrapAll(controller) {
  const wrapped = {};
  Object.keys(controller).forEach((key) => {
    wrapped[key] = typeof controller[key] === 'function' ? catchAsync(controller[key]) : controller[key];
  });
  return wrapped;
}

module.exports = catchAsync;
module.exports.wrapAll = wrapAll;
