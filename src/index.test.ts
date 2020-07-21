const assert = require('assert');
const XPathBaobab = require('../lib/index').default;

describe('First try', () => {
  it('First test', () => {
    const xpath = 'page/node';
    const tree = {
      name: 'page',
      children: [
        {
          name: 'node',
          children: [],
        }
      ],
     };

     const res = new XPathBaobab(tree).parse(xpath);
     assert.equal((res).length, 1)
  });
});
