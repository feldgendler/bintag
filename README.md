# bintag

```js
var bintag = require('bintag');
```

A Node.js module for creating buffers using tagged template strings.

## Introduction

This module uses the [tagged template
string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/template_strings#Tagged_template_strings)
syntax to fill buffers with structured binary data.

The simplest example:

```js
> bintag`i4: 1 2 -10 0xaabbccdd`
<Buffer 01 00 00 00 02 00 00 00 f6 ff ff ff dd cc bb aa>
```

The `i4:` is a _format specifier_ which means that the numbers following it
should be formatted as 4-byte integers.
