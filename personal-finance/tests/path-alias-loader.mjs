import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return {
      url: pathToFileURL(resolvePath(process.cwd(), 'src', `${specifier.slice(2)}.ts`)).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
