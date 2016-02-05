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

For `i2` and upwards, endianness matters. See below.

### Hexadecimal data

The format specifier is just `x`. It expects an even number of hexadecimal
digits:

```js
bintag`x: 12 34 abcdef`
// = <Buffer 12 34 ab cd ef>
```

Whitespace between pairs is optional. The only case when this whitespace
matters is when a repeat count (see below) is used: it will apply to a whole
“word” of hexadecimal data.

The `x` format specifier handles substitution expressions like `i1`.

This format is **not** affected by endianness.

### Floating point

The format specifiers are `f` for “float” (32-bit) and `d` for “double”
(64-bit) types.

```js
bintag`f: -1.1 d: .5e-10`
// = <Buffer cd cc 8c bf bb bd d7 d9 df 7c cb 3d>
```

The standard JS syntax for floating-point literals is supported, including
`Infinity` with an optional sign, and `NaN`. Note that `-0` produces binary
data distinct from `0`.

The format is affected by endianness.

### Strings

The three string formats are `a` for ASCII, `u` for UTF-8, and `U` for UTF-16.
When a string is forced to ASCII, the lower byte of each character's Unicode
value will be used.

With string formats, substitution expressions **must** be used. There is no
syntax for string values in the template string.

When a bare string format specifier is used, the result will take exactly the
number of bytes that are necessary to represent all the characters of a string:

```js
bintag`a: ${'abc'}`
// = <Buffer 61 62 63>
```

If the format letter is followed by an integer constant (or a substitution
expression evaluating to an integer), the string will take exactly the
specified number of bytes, and will be truncated or zero-padded as necessary.

```js
bintag`a4: ${['ab', 'xyzzy']}`
// = <Buffer 61 62 00 00 78 79 7a 7a>
```

When a Unicode string is truncated, an incomplete character at the end is never
encoded. If necessary, the string will be zero-padded:

```js
bintag`u8: ${'\u1000\u1000\u1000'}`
// = <Buffer e1 80 80 e1 80 80 00 00>
```

The `z` modifier adds a terminating zero byte (two bytes in case of UTF-16).

```js
bintag`az: ${'abc'}`
// = <Buffer 61 62 63 00>
```

If `z` is combined with a fixed length, the length includes the terminator, and
the string is guaranteed to be zero-terminated. This means that it might be
truncated earlier than without `z` to accomodate the terminator.

The `p` modifier, followed by an integer between 1 and 4 (or a substitution
expression evaluating to such an integer), makes the string a “Pascal string”:
length followed by string data. The number specifies the width of the length
field.

```js
bintag`ap2: ${'abc'}`
// = <Buffer 03 00 61 62 63>
```

For UTF-8, the number of bytes is stored in the length field rather than the
number of Unicode characters. For UTF-16, the number of two-byte pairs is
stored, which can be different from the number of Unicode characters when
surrogate pairs are present.

The length field respects endianness. Strings longer than the maximum length
than can be represented in a length field of the chosen size (such as 255
characters for a 1-byte length), will be truncated.

If the `p` modifier is combined with a fixed length, the latter includes the
size of the length field. Therefore, the fixed length must be greater than the
size of the length field.

```js
bintag`a8p1: ${['abc', '0123456789']}`
// = <Buffer 03 61 62 63 00 00 00 00 07 30 31 32 33 34 35 36>
```

The UTF-16 encoding is affected by endianness, but ASCII and UTF-8 are not.
