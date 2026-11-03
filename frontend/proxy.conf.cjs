// Native development only; Docker uses nginx.conf and service DNS.
module.exports = {
  '/api/**': { target: 'http://127.0.0.1:8080', secure: false },
  '/identity/token': {
    target: 'http://127.0.0.1:9000', secure: false,
    pathRewrite: { '^/identity/token$': '/token' }
  }
};
