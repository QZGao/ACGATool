import test from 'node:test';
import assert from 'node:assert/strict';
import {entryOwnership, isOwnNomination, assertCanCheck} from '../src/nomination/ownership.js';
import {queryEntry} from '../src/wiki/api.js';

test('only the original award recipient is blocked, regardless of nominator or login status', () => {
    const text = '=== 10月14日 ===\n{{ACG提名2\n|條目名稱1 = A\n|用戶名稱1 = Awarder\n|條目名稱2 = B\n|用戶名稱2 = Someone\n}}\n提名人：[[User:Example_User|custom signature]]\n=== 10月15日 ===\n{{ACG提名2\n|條目名稱1 = C\n|用戶名稱1 = Third\n}}\n提名人：[[User:Other]]';
    for (const index of [1, 2]) {
        const owner = entryOwnership(text, queryEntry(text, '10月14日', index));
        assert.deepEqual(owner.nominators, ['Example User']);
        assert.equal(isOwnNomination(owner, 'Example User'), false);
        assert.equal(isOwnNomination(owner, 'Other'), false);
        assert.doesNotThrow(() => assertCanCheck(owner, 'Example_User'));
        assert.throws(() => assertCanCheck(owner, owner.awarder), /自己為得分者/);
    }
    const formatted = text.replace('提名人：', "'''提名人'''：");
    const owner = entryOwnership(formatted, queryEntry(formatted, '10月14日', 1));
    assert.equal(isOwnNomination(owner, 'Example User'), false);
    const aliases = formatted.replace('User:Example_User', 'U:Example_User');
    assert.equal(isOwnNomination(entryOwnership(aliases, queryEntry(aliases, '10月14日', 1)), 'Example User'), false);
    assert.equal(isOwnNomination(owner, 'Awarder'), true);
    assert.throws(() => assertCanCheck(owner, 'User:Awarder'));
    assert.doesNotThrow(() => assertCanCheck(owner, 'Reviewer'));
    assert.doesNotThrow(() => assertCanCheck({...owner, nominators: []}, 'Reviewer'));
    assert.doesNotThrow(() => assertCanCheck(owner, null));
    assert.equal(isOwnNomination(owner, null), false);
});
