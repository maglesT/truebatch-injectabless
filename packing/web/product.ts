import { product } from '../../web/src/product.js';

// Imported first by main.tsx, so every screen module sees the packing product when it loads.
Object.assign(product, {
  name: 'TrueBatch Injectables Packing',
  about: 'The packing batch record: from the released, filled and inspected units to QA release of the packed batch.',
  masters: 'Packing masters',
  packing: true,
});
