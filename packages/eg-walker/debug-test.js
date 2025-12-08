const { EgWalker } = require('./dist/eg-walker.js');

const egWalker = new EgWalker();

// Initial state: "abc"
egWalker.applyEvent({
  id: 'init',
  type: 'insert',
  position: 0,
  content: 'abc',
  parentVersion: [],
  timestamp: 100
});

console.log('After init:', egWalker.getDocument());

// User A deletes 'b' (position 1)
egWalker.applyEvent({
  id: 'a1',
  type: 'delete',
  position: 1,
  parentVersion: ['init'],
  timestamp: 200
});

console.log('After delete a1:', egWalker.getDocument());

// User B also tries to delete 'b' (position 1) concurrently
egWalker.applyEvent({
  id: 'b1',
  type: 'delete',
  position: 1,
  parentVersion: ['init'],
  timestamp: 200
});

console.log('After delete b1:', egWalker.getDocument());
console.log('Expected: ac');
