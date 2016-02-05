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
bintag`i4: 1 2 -10 0xaabbccdd`
// = <Buffer 01 00 00 00 02 00 00 00 f6 ff ff ff dd cc bb aa>
```

The expression evaluates to a new `Buffer` instance.

The `i4:` is a _format specifier_ which means that the numbers following it
should be formatted as 4-byte integers.

Note that template strings can be multi-line:

```js
bintag`i1:
    0x12 0x34
    0x56 0x78`
// = <Buffer 12 34 56 78>
```

## Substitutions

The template string syntax allows substitutions: `${`_expression_`}`. With
`bintag`, you can use substitutions as values to be formatted as well as in
other syntactic constructs.

### Substitutions as values

A substitution expression can evaluate to a single value:

```js
let n = 10;
bintag`i4: ${n}`
// = <Buffer 0a 00 00 00>
```

It can evaluate to an array of values:

```js
let array = [1, 2, 3];
bintag`i1: ${array}`
// = <Buffer 01 02 03>
```

Nested arrays will be flattened:

```js
let array = [1, [2], 3, [[4]], [5, 6], 7];
bintag`i1: ${array}`
// = <Buffer 01 02 03 04 05 06 07>
```

Anything
[iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#iterable),
such as a `Set` or a generator, will be treated the same way as an array:

```js
function* gen(){
    yield 1;
    yield 2;
    yield [3, 4];
}
bintag`i1: ${gen()}`
// = <Buffer 01 02 03 04>
```

Unless the iterable is a generator, it must produce stable results on two
subsequent traversals, or the result will be undefined.

A substitution expression can also evaluate to a `Buffer`:

```js
let buf = bintag`i1: 0xaa 0xbb`;
bintag`${buf} i2: 2 ${buf}`
// = <Buffer aa bb 02 00 aa bb>
```

Arrays and nested arrays of buffers are also supported. You can even mix
buffers with immediate values in the same array. An empty array produces no
buffer content.

Finally, a substitution expression can evaluate to a compiled `bintag` template
(see below).

### Substitutions in other positions

A substitution is generally allowed wherever the syntax expects an integer,
such as in a format specifier:

```js
let n=2;
bintag`i${n}: 1`
// = <Buffer 01 00>
```

When used in this way, the substitution expression must evaluate to an integer,
or to something that can be converted to an integer. (`1.6` will happily become
`1`, but `{}` becomes `NaN` and will be rejected.)

A substitution cannot be used in place of parts of the syntax that are not
numbers, such as the letter of a format specifier.

## Format specifiers

All format specifiers end with a colon. Whitespace after the colon is optional.

A format specifier itself does not produce any buffer content, but it specifies
the format in which the values following it are to be formatted. The format
remains active until another format specifier is encountered:

```js
bintag`i1: 1 2 i4: 7 i1: 8`
// = <Buffer 01 02 07 00 00 00 08>
```

**Note:** format specifiers are case-sensitive.

### Integers

The integer format specifier is the letter `i` followed by a number between 1
and 6. Each formatted integer will take the specified number of bytes in the
buffer.

This format specifier accepts decimal integers with an optional sign, as well
as unsigned hexadecimal nubmers:

```js
bintag`i1: 1 +1 -1 0x80 128 -128`
// = <Buffer 01 01 ff 80 80 80>
```

Both positive and negative values can be used to represent certain bit
patterns, such as `80` in the example above.

A value that is out of range for both signed and unsigned integers of the
specified width, will trigger an exception.
