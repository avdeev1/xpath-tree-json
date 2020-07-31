# @avdeev1/xpath-tree-json
Library for search nodes in document by XPath query.
Developed in the fall of 2019 at Yandex during an internship.

---

## Installing

#### Install from the command line:
```bash
$ npm install @avdeev1/xpath-tree-json@1.0.9
```

#### Install via package.json:
```bash
"@avdeev1/xpath-tree-json": "1.0.9"
```

---

Example: `page/node[attr1 or attr2]`
Result: 
```
page-|
     |
     |
     |- node(attr1) ✅
     |
     |
     |- node(attr2) ✅
     |
     |
     |- anotherNode-|
     |              |
     |              |- node(attr1) 🚫
     |
     |- node 🚫
```

---

Dependencies: [xpath-analyzer](https://github.com/badeball/xpath-analyzer#readme) -> [xpath-lexer](https://github.com/badeball/xpath-lexer#readme)

---

## Usage (ES modules):
```js
import XPathBaobab from 'xpath-tree-json';

const xpath = 'page/node';
const tree = {
  name: 'page',
  children: [
    {
      name: 'node',
      children: [],
    }
  ],
 }
 
new XPathBaobab(tree).parse(xpath);

// { name: 'node', children: [] }
```
