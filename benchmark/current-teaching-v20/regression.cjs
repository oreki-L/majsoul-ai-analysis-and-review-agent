'use strict';
const assert = require('node:assert/strict');
const { run } = require('../current-teaching-v17/regression.cjs');
const v19 = require('../current-teaching-v19/regression.cjs');

function checkFacts(id, facts) {
  v19.checkFacts(id, facts);
  const discard = facts.explanationFocus.discard;
  switch (id) {
    case 'd-6972049311ac20bc99692400': {
      const row = facts.dora.indicators.find(item => item.indicator.code === '5s');
      assert.equal(row.dora.code, '6s');
      assert.equal(row.wording, '指示牌是5索，对应宝牌是6索');
      break;
    }
    case 'expanded-east3-h0-p38':
      assert.match(discard.efficiencyComparison.sameShantenUnseen.wording, /同档切9万为最高78枚/);
      break;
    case 'expanded-east3-h0-p70':
      assert.match(discard.efficiencyComparison.sameShantenUnseen.wording, /同档切北为最高39枚/);
      break;
    case 'd-7fc98dad5e7bd278190fa075':
      assert.match(discard.fixedYakuhaiSources.join(''), /明刻「东」提供役牌/);
      break;
    case 'd-b2703905f245c3f3f25e00cb':
      assert.equal(discard.tenpai, null);
      assert.match(discard.fixedYakuhaiSources.join(''), /明刻「东」提供役牌/);
      break;
    case 'd-68d41451aa65cd8dfbe17482-safety-question': {
      const row = discard.safetyByOpponent.find(item => item.relativeName === '上家');
      assert.equal(row.status, 'unknown');
      assert.equal(row.sujiReferenceWording, '上家牌河的6筒是3筒的筋参考，筋不能确认安全');
      break;
    }
  }
}

run(process.argv.slice(2), { prompt: 20, facts: 15 }, {
  questions: v19.questions,
  checkFacts,
  extraCode: ['benchmark/current-teaching-v19/regression.cjs'],
  priorRound: {
    directory: 'current-teaching-v19-main-ready-20261123',
    hash: '878ffaf3d588e189021ed000d65f5a22b29e884bffb0c32dcc28732ec87ebf75'
  }
});
