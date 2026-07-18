// Ambient module shims for untyped dependencies.
//
// react-native-zeroconf ships no TypeScript declarations and has no
// DefinitelyTyped counterpart (confirmed during the 2A.4-T1 audit). This
// shorthand `declare module` gives it `any` typing at compile time so the
// mobile TS migration is not blocked on a single untyped native module.
//
// Scope discipline: only add a shim here when (a) the package ships no types
// AND (b) no @types/* counterpart exists. Anything else should use a real
// @types/* package (declared in package.json devDependencies).

declare module 'react-native-zeroconf';
