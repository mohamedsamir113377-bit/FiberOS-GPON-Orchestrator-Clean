'use strict';
exports.double = (n) => Number(n) * 2;
exports.divideOneBy = (n) => {
  if (Number(n) === 0) throw new RangeError('division by zero');
  return 1 / Number(n);
};
