// Refuse to publish a CLI whose editor dependency has no built dist/ (broke artisan-uml@1.2.1).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require.resolve('artisan-uml/dist/index.html');
  console.log('✓ artisan-uml ships dist/index.html');
} catch {
  console.error(
    '✗ artisan-uml does not ship dist/index.html — publish artisan-uml@^1.2.2 (or build it locally) before this package'
  );
  process.exit(1);
}
