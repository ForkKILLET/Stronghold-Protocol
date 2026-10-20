// Legacy geometry contracts compare design lengths. Viewport scaling and real
// touch/overflow behavior are checked separately by management-scale and browser tests.
export const designCss=source=>source.replace(/calc\((-?\d*\.?\d+) \* var\(--ui-unit, 1rem\)\)/g,'$1rem');
