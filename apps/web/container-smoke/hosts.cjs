const dns = require('node:dns');
const originalLookup = dns.lookup;
const mapped = new Set((process.env.CARE_SYNTHETIC_HOSTS ?? '').split(',').filter(Boolean));
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (mapped.has(hostname)) {
    if (options && options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }]);
    return callback(null, '127.0.0.1', 4);
  }
  return originalLookup.call(this, hostname, options, callback);
};
