// Lets node:test import the app's ESM files, which use extensionless
// relative imports (Next's bundler resolves them; plain Node does not).
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context)
      throw e
    }
  },
})
