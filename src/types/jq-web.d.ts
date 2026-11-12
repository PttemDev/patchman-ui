// jq-web ships no types. It's an Emscripten MODULARIZE factory:
// `await factory({ locateFile })` resolves to a Module exposing raw()/json().
declare module 'jq-web';
