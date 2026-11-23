'use strict';
const assert = require('node:assert/strict');
const { run } = require('../current-teaching-v17/regression.cjs');

const questions = new Map([
  ['expanded-east1-h0-p86', '这张西对下家安全吗？西四枚可见能确认什么？'],
  ['expanded-east1-h0-p104', '打南对下家是现物吗？依据是下家的哪张弃牌？'],
  ['d-c81710fccaa98f25522d6177', '北对已立直的对家有安全依据吗？'],
  ['d-68d41451aa65cd8dfbe17482', '3筒对上家有筋的依据吗？能因此确认安全吗？'],
  ['expanded-south2-h2-p72', '上家已立直，打赤5万对上家安全吗？依据是什么？'],
  ['d-7fc98dad5e7bd278190fa075', '打白对已经立直的对家是现物吗？'],
  ['d-f4d600845cffa498bec7c44e', '赤5筒对上家和对家分别安全吗？'],
  ['d-6fbe6cd21c4bbc1d4066fb24', '发对上家有已确认的安全依据吗？'],
  ['expanded-east3-h0-p14', '这张南对上家安全吗？能确认到什么程度？'],
  ['d-4b779daf10bf82c830c9632f', '6筒对下家有安全依据吗？筋和现物有什么区别？'],
]);

const checkFacts = (id, facts) => {
  if (!id.endsWith('-safety-question')) return;
  const byOpponent = facts.explanationFocus.discard.safetyByOpponent;
  assert.equal(byOpponent.length, 3);
  for (const row of byOpponent) {
    if (row.status === 'confirmed') {
      assert.ok(row.wording[0]?.includes(row.relativeName));
      assert.equal(row.evidenceGapWording, null);
    } else {
      assert.deepEqual(row.wording, []);
      assert.ok(row.evidenceGapWording.includes(row.relativeName));
    }
  }
  const opponent = name => byOpponent.find(row => row.relativeName === name);
  if (id.startsWith('d-2a54d453702769e3bee42a22')) {
    assert.equal(opponent('下家').evidenceGapWording, '下家当前可见牌河未找到同种牌。当前资料未确认7筒对下家的安全依据');
  } else if (id.startsWith('d-06fc9e61eec0210e70e0ebbe')) {
    assert.deepEqual(opponent('对家').wording, ['对家本人牌河第5张弃过东，东对对家是现物']);
  } else if (id.startsWith('expanded-east1-h0-p86')) {
    assert.equal(opponent('下家').evidence[0].type, 'visible-exclusion');
  } else if (id.startsWith('d-68d41451aa65cd8dfbe17482')) {
    assert.equal(opponent('上家').status, 'unknown');
    assert.ok(opponent('上家').sujiReferences.some(tile => tile.name === '6筒'));
  }
};

run(process.argv.slice(2), { prompt: 19, facts: 14 }, {
  questions, checkFacts,
  priorRound: { directory: 'current-teaching-v18-ready-20261123', hash: 'e44fe052f76598e35a3aa5f4ae8e429c227dea4b48d8609ee1b7748aa0eed593' }
});
