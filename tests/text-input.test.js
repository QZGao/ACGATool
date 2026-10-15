import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {bindTextInput} from '../src/text-input.js';

function widget(value = '') {
    const events = new Map(), control = new EventEmitter();
    control.value = value;
    control.writes = 0;
    control.$input = {
        val: () => control.value,
        on(name, handler) { events.set(name.split('.')[0], handler); return this; },
        off() { events.clear(); },
    };
    control.event = name => events.get(name)?.();
    control.type = value => { control.value = value; control.emit('change', value); };
    control.setValue = value => { control.writes++; control.type(value); };
    return control;
}

test('autosave echoes never write back into the text control and external restores do not save again', () => {
    const input = widget('原文'), committed = [];
    const binding = bindTextInput(input, value => committed.push(value));
    input.type('本地修改');
    binding.sync('本地修改'); binding.sync('本地修改');
    assert.equal(input.writes, 0);
    binding.sync('外部修改');
    assert.equal(input.writes, 1);
    assert.deepEqual(committed, ['本地修改']);
    binding.destroy();
});

test('composition is committed once after the final input in either event order, without external overwrite', async () => {
    for (const inputBeforeEnd of [true, false]) {
        const input = widget('原文'), committed = [];
        const binding = bindTextInput(input, value => committed.push(value));
        input.event('compositionstart');
        input.type('原文pin');
        assert.equal(binding.sync('另一分頁的值'), false);
        assert.equal(input.value, '原文pin');
        assert.equal(input.writes, 0);
        assert.deepEqual(committed, []);
        const done = binding.settled();
        if (inputBeforeEnd) input.type('原文拼');
        input.event('compositionend');
        if (!inputBeforeEnd) input.type('原文拼');
        assert.deepEqual(committed, []);
        await done;
        assert.deepEqual(committed, ['原文拼']);
        assert.equal(binding.isComposing(), false);
        binding.sync('原文拼');
        assert.equal(input.writes, 0);
        binding.destroy();
    }
});
