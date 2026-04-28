const pretext = require('@chenglou/pretext');

const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const prepared = pretext.prepareWithSegments(text, "10px Arial");

const { lines } = pretext.layoutWithLines(prepared, 50, 12);
console.log(lines);
