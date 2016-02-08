'use strict'; /*jshint node:true*/
var os = require('os');

var bintag = module.exports = Object.assign(tag(''), {
    tag,
    LE: tag('LE:'),
    BE: tag('BE:'),
    hex: tag('x:'),
});

function tag(options){
    let tag_fn = function(parts){
        let values = new Array(arguments.length-1);
        for (let i = 1; i<arguments.length; i++)
            values[i-1] = arguments[i];
        return new Template(options, parts, values).create();
    };
    tag_fn.compile = function(parts){
        let values = new Array(arguments.length-1);
        for (let i = 1; i<arguments.length; i++)
            values[i-1] = arguments[i];
        return new Template(options, parts, values);
    };
    tag_fn.tag = more_options=>tag(options+' '+more_options);
    return tag_fn;
}

function parse(parts, values)
{
    function* characters(){
        for (let i = 0; i<parts.length; i++)
        {
            if (i)
                yield new Value(values[i-1]);
            for (let c of parts[i])
                yield c;
        }
    }
    function* tokens(){
        let cur = [];
        function token(){
            let res = cur;
            cur = [];
            return res;
        }
        for (let c of characters())
        {
            switch (c)
            {
            case '#':
                if (cur.length)
                    yield token();
                cur.push(c);
                break;
            case '*':
            case ':':
            case '(':
                cur.push(c);
                yield token();
                break;
            case ')':
                if (cur.length)
                    yield token();
                cur.push(c);
                yield token();
                break;
            default:
                if (/[\s]/.test(c))
                {
                    if (cur.length)
                        yield token();
                }
                else
                    cur.push(c);
            }
        }
        if (cur.length)
            yield token();
    }
    let groups = [undefined], gen = tokens();
    function* group(inner, context){
        let repeater;
        function wrap_repeater(item){
            if (repeater!==undefined)
            {
                item = new ItemRepeat(context, repeater, item);
                repeater = undefined;
            }
            return item;
        }
        for (let step = gen.next(); !step.done; step = gen.next())
        {
            let token = step.value;
            if (token.length==1 && token[0]===')')
            {
                if (!inner || repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                return;
            }
            if (token.length==3 && token[1]==='E' && token[2]===':')
            {
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                switch (token[0])
                {
                case 'B':
                case 'L':
                    context.endianness = token[0]+'E';
                    continue;
                default:
                    throw new ParseError('Unrecognized option',
                        token.slice(0, -1));
                }
            }
            if (token[token.length-1]===':')
            {
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                switch (token[0])
                {
                case 'i':
                    if (token.length<=2)
                        break;
                    context.format = new FormatInt(
                        parse_int(token.slice(1, -1)));
                    continue;
                case 'f':
                case 'd':
                    if (token.length!=2)
                        break;
                    context.format = new FormatFloat(token[0]);
                    continue;
                case 'x':
                    if (token.length!=2)
                        break;
                    context.format = new FormatHex();
                    continue;
                case 'a':
                case 'u':
                case 'U':
                    context.format = new FormatString(token.slice(0, -1));
                    continue;
                }
                throw new ParseError('Unrecognized option',
                    token.slice(0, -1));
            }
            if (token.length==1 && token[0] instanceof Value)
            {
                yield wrap_repeater(new ItemValue(context, token[0].value));
                continue;
            }
            if (token[token.length-1]==='*')
            {
                if (token.length==1)
                    throw new ParseError('Syntax error', token);
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                repeater = parse_int(token.slice(0, -1));
                continue;
            }
            if (token[0]==='#')
            {
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                if (token.length==2 && token[1] instanceof Value)
                {
                    yield new ItemLength(context,
                        new ItemValue(context, token[1].value));
                    continue;
                }
                if (token.length==2 && token[1]==='(')
                {
                    let index = groups.length;
                    groups.push(undefined);
                    let item = groups[index] = new ItemGroup(group(true,
                        new Context(context)));
                    yield new ItemLength(context, item);
                    continue;
                }
                yield new ItemGroupLength(context, groups,
                    parse_int(token.slice(1)));
                continue;
            }
            if (token[0]==='@')
            {
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                if (token.length==1 || token[1] instanceof Value)
                    throw new ParseError('Syntax error', token);
                yield new ItemGroupOffset(context, groups,
                    parse_int(token.slice(1)));
                continue;
            }
            if (token.length==1 && token[0]==='(')
            {
                let index = groups.length;
                groups.push(undefined);
                yield groups[index] = wrap_repeater(
                    new ItemGroup(group(true, new Context(context))));
                continue;
            }
            if (token[0]==='p')
            {
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                yield new ItemPadding(context,
                    token.length>1 ? parse_int(token.slice(1)) : undefined);
                continue;
            }
            if (token[0]==='=')
            {
                if (repeater!==undefined)
                    throw new ParseError('Unexpected', token);
                yield new ItemSkip(context, parse_int(token.slice(1)));
                continue;
            }
            if (context.format)
            {
                yield wrap_repeater(new ItemValue(context,
                    context.format.parse(token)));
                continue;
            }
            throw new ParseError('Format not specified', token);
        }
        if (inner || repeater!==undefined)
            throw new ParseError('Premature end of template');
    }
    groups[0] = new ItemGroup(group(false, new Context()));
    groups[0].bind(0);
    return groups[0];
}

function* flatten(obj)
{
    if (typeof obj=='object' && obj!==null && obj[Symbol.iterator]
        && !(obj instanceof Buffer))
    {
        for (let item of obj)
            yield *flatten(item);
    }
    else
        yield obj;
}

function parse_plain(token)
{
    for (let c of token)
    {
        if (c instanceof Value)
            throw new ParseError('Unexpected substitution', token);
    }
    return token.join('');
}

function parse_int(token)
{
    if (token.length==1 && token[0] instanceof Value)
        return Math.trunc(+token[0].value);
    let plain = parse_plain(token);
    if (/^([-+]?\d+|0x[\da-f]+)$/i.test(plain))
        return +plain;
    throw new ParseError('Integer expected', token);
}

function parse_num(token)
{
    if (token.length==1 && token[0] instanceof Value)
        return +token[0].value;
    let plain = parse_plain(token);
    let res = +plain;
    if (isNaN(res) && plain!='NaN')
        throw new ParseError('Number expected', token);
    return res;
}

class Template {
    constructor(options, parts, values){
        if (options)
        {
            parts = parts.slice();
            parts[0] = options+' '+parts[0];
        }
        this.root = parse(parts, values);
    }
    create(){
        let buf = new Buffer(this.length);
        this.write(buf);
        return buf;
    }
    get length(){ return this.root.length; }
    write(buf, offset){
        this.root.encode(buf, offset||0);
        return this.root.length;
    }
}

class Value {
    constructor(value){ this.value = value; }
    toString(){ return ''; }
}

class Context {
    constructor(orig){
        this.endianness = orig ? orig.endianness : os.endianness();
        this.format = orig && orig.format;
    }
}

class Format {
    constructor(align){ this.align = align; }
    parse(token){ throw new ParseError('Syntax error', token); }
}

class FormatInt extends Format {
    constructor(size){
        if (size<1 || size>6)
            throw new ParseError('Unsupported integer size: '+size);
        super(size);
    }
    parse(token){ return parse_int(token); }
    length(value){ return this.align; }
    encode(value, endianness, buf, offset){
        value = +value;
        if (!isFinite(value))
            throw new ParseError('Integer expected');
        switch (endianness){
        case 'LE':
            if (value<0)
                buf.writeIntLE(value, offset, this.align);
            else
                buf.writeUIntLE(value, offset, this.align);
            break;
        case 'BE':
            if (value<0)
                buf.writeIntBE(value, offset, this.align);
            else
                buf.writeUIntBE(value, offset, this.align);
            break;
        }
        return this.align;
    }
}

class FormatFloat extends Format {
    constructor(type){ super(type=='f' ? 4 : 8); }
    parse(token){ return parse_num(token); }
    length(value){ return this.align; }
    encode(value, endianness, buf, offset){
        value = +value;
        if (isNaN(value))
            value = NaN;
        switch (endianness+this.align)
        {
        case 'LE4': buf.writeFloatLE(value, offset); break;
        case 'BE4': buf.writeFloatBE(value, offset); break;
        case 'LE8': buf.writeDoubleLE(value, offset); break;
        case 'BE8': buf.writeDoubleBE(value, offset); break;
        }
        return this.align;
    }
}

class FormatHex extends Format {
    constructor(){ super(1); }
    parse(token){
        let res = [];
        for (let i = 0; i<token.length; i++)
        {
            if (token[i] instanceof Value)
                res.push(token[i].value);
            else
            {
                let pair = token[i]+token[i+1];
                if (!/^[\da-f]{2}$/i.test(pair))
                    throw new ParseError('Invalid hex sequence', token);
                res.push(parseInt(pair, 16));
                i++;
            }
        }
        return res;
    }
    length(value){ return 1; }
    encode(value, endianness, buf, offset){
        value = +value;
        if (!isFinite(value))
            throw new ParseError('Value is not an integer');
        value = value|0;
        if (value<-128 || value>255)
            throw new ParseError('Value out of byte range: '+value);
        buf[offset] = value;
        return 1;
    }
}

class FormatString extends Format {
    constructor(spec){
        super(spec[0]=='U' ? 2 : 1);
        this.type = spec[0];
        this.size = 0;
        this.terminated = 0;
        this.meta_size = 0;
        this.limit = 0;
        this.encoding = undefined;
        switch (this.type)
        {
        case 'a': this.encoding = 'ascii'; break;
        case 'u': this.encoding = 'utf8'; break;
        case 'U': this.encoding = 'utf16le'; break;
        }
        let pos = 1;
        let size_str = '';
        while (pos<spec.length && /\d/.test(spec[pos]))
            size_str += spec[pos++];
        if (size_str)
            this.size = +size_str;
        else if (spec[pos] instanceof Value)
            this.size = +spec[pos++].value;
        if (!isFinite(this.size) || this.size<0)
            throw new ParseError('Invalid string size', spec);
        this.size = this.size|0;
        this.limit = this.size;
        if (spec[pos]==='z')
        {
            pos++;
            this.terminated = this.type=='U' ? 2 : 1;
        }
        else if (spec[pos]==='p')
        {
            let meta_size_str = '';
            pos++;
            while (pos<spec.length && /\d/.test(spec[pos]))
                meta_size_str += spec[pos++];
            if (meta_size_str)
                this.meta_size = +meta_size_str;
            else if (spec[pos] instanceof Value)
                this.meta_size = +spec[pos++].value;
            else
                throw new ParseError('Invalid string format', spec);
            if (!isFinite(this.meta_size)
                || this.meta_size<1 || this.meta_size>4)
            {
                throw new ParseError('Invalid string format', spec);
            }
            this.meta_size = this.meta_size|0;
            if (this.size && this.size<=this.meta_size)
                throw new ParseError('Invalid string format', spec);
            if (this.meta_size<4)
            {
                let limit = 1<<(this.meta_size*8);
                this.limit = this.limit ? Math.min(this.limit, limit) : limit;
            }
        }
        if (pos!=spec.length)
            throw new ParseError('Invalid string format', spec);
    }
    length(value){
        if (this.size)
            return this.size;
        let res = Buffer.byteLength(String(value), this.encoding)
            +this.terminated+this.meta_size;
        return this.limit ? Math.min(res, this.limit) : res;
    }
    encode(value, endianness, buf, offset){
        let len = this.length(value);
        let start = offset+this.meta_size;
        let max = len-this.meta_size-this.terminated;
        let bytes = buf.write(String(value), start, max, this.encoding);
        if (this.type=='U' && endianness=='BE')
        {
            for (let i = start; i<start+bytes; i+=2)
                buf.writeUInt16BE(buf.readUInt16LE(i), i);
        }
        if (this.meta_size)
        {
            let size = this.type=='U' ? bytes/2 : bytes;
            switch (endianness)
            {
            case 'LE': buf.writeUIntLE(size, offset, this.meta_size); break;
            case 'BE': buf.writeUIntBE(size, offset, this.meta_size); break;
            }
        }
        buf.fill(0, start+bytes, offset+len);
        return len;
    }
}

class Item {
    constructor(context){
        this.context = new Context(context);
        this.offset = undefined;
        this.length = 0;
    }
    bind(offset){ this.offset = offset; }
    get inner_length(){ return this.length; }
}

class ItemValue extends Item {
    constructor(context, value){
        super(context);
        this.value = value;
        if (this.value && typeof this.value.next=='function')
            this.value = Array.from(this.value);
    }
    bind(offset){
        super.bind(offset);
        for (let item of flatten(this.value))
        {
            if (item instanceof Buffer)
                this.length += item.length;
            else if (item instanceof Template)
                this.length += item.length;
            else
            {
                if (!this.context.format)
                    throw new ParseError('Format not specified');
                this.length += this.context.format.length(item);
            }
        }
    }
    encode(buf, base){
        let offset = base+this.offset;
        for (let item of flatten(this.value))
        {
            if (item instanceof Buffer)
                offset += item.copy(buf, offset);
            else if (item instanceof Template)
                offset += item.write(buf, offset);
            else
            {
                offset += this.context.format.encode(item,
                    this.context.endianness, buf, offset);
            }
        }
    }
}

class ItemPadding extends Item {
    constructor(context, align){
        super(context);
        this.align = align;
        if (align===undefined)
        {
            if (!this.context.format)
                throw new ParseError('Format not specified');
            this.align = this.context.format.align;
        }
        if (this.align<1)
            throw new ParseError('Invalid alignment: '+this.align);
    }
    bind(offset){
        super.bind(offset);
        this.length = this.align - this.offset%this.align;
        if (this.length==this.align)
            this.length = 0;
    }
    encode(buf, base){
        let offset = base+this.offset;
        buf.fill(0, offset, offset+this.length);
    }
}

class ItemSkip extends Item {
    constructor(context, target){
        super(context);
        this.target = target;
    }
    bind(offset){
        super.bind(offset);
        this.length = this.target-this.offset;
        if (this.length<0)
        {
            throw new ParseError('Cannot skip from offset '+this.offset
                +' to offset '+this.target);
        }
    }
    encode(buf, base){
        let offset = base+this.offset;
        buf.fill(0, offset, offset+this.length);
    }
}

class ItemRepeat extends Item {
    constructor(context, repeat, item){
        super(context);
        this.repeat = repeat;
        this.item = item;
        if (this.repeat<0)
            throw new ParseError('Negative repeat count: '+this.repeat);
    }
    bind(offset){
        super.bind(offset);
        this.item.bind(0);
        this.length = this.repeat*this.item.length;
    }
    encode(buf, base){
        let offset = base+this.offset;
        for (let i = 0; i<this.repeat; i++)
        {
            this.item.encode(buf, offset);
            offset += this.item.length;
        }
    }
    get inner_length(){ return this.item.length; }
}

class ItemLength extends Item {
    constructor(context, item){
        super(context);
        this.item = item;
    }
    bind(offset){
        super.bind(offset);
        if (!this.context.format)
            throw new ParseError('Format not specified');
        this.length = this.context.format.length(0);
        this.item.bind(0);
    }
    encode(buf, base){
        let offset = base+this.offset;
        this.context.format.encode(this.item.length, this.context.endianness,
            buf, offset);
    }
}

class ItemGroupLength extends Item {
    constructor(context, groups, index){
        super(context);
        this.groups = groups;
        this.index = index;
    }
    bind(offset){
        super.bind(offset);
        if (!this.context.format)
            throw new ParseError('Format not specified');
        this.length = this.context.format.length(0);
        if (this.index<0 || this.index>=this.groups.length)
            throw new ParseError('Invalid reference: #'+this.index);
    }
    encode(buf, base){
        let offset = base+this.offset;
        this.context.format.encode(this.groups[this.index].inner_length,
            this.context.endianness, buf, offset);
    }
}

class ItemGroupOffset extends Item {
    constructor(context, groups, index){
        super(context);
        this.groups = groups;
        this.index = index;
    }
    bind(offset){
        super.bind(offset);
        if (!this.context.format)
            throw new ParseError('Format not specified');
        this.length = this.context.format.length(0);
        if (this.index<0 || this.index>=this.groups.length)
            throw new ParseError('Invalid reference: @'+this.index);
    }
    encode(buf, base){
        let offset = base+this.offset;
        this.context.format.encode(this.groups[this.index].offset,
            this.context.endianness, buf, offset);
    }
}

class ItemGroup extends Item {
    constructor(items){
        super();
        this.items = Array.from(items);
    }
    bind(offset){
        super.bind(offset);
        for (let item of this.items)
        {
            item.bind(offset+this.length);
            this.length += item.length;
        }
    }
    encode(buf, base){
        for (let item of this.items)
            item.encode(buf, base);
    }
}

class ParseError extends Error {
    constructor(message, token){
        if (token)
        {
            message += ': ';
            for (let c of token)
                message += c instanceof Value ? '${...}' : c;
        }
        super('bintag template parse error: '+message);
    }
}
