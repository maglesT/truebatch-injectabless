// Which product this web UI is: TrueBatch Injectables (web/src/main.tsx) or TrueBatch Injectables Packing, whose entry
// (packing/web/main.tsx) sets it before the screens load. The server checks everything again.
export const product = {
  name: 'TrueBatch Injectables',
  about: 'Electronic batch records for sterile injectables, from dispensing to QA release of filled, closed, inspected units.',
  // What the product calls its master records: the tab, the page heading and the way back to it.
  masters: 'Master records',
  packing: false,
};
