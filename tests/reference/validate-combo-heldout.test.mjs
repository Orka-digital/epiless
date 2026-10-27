import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  expectedComboChannels,
  validateComboContract,
  verifyComboCorpus,
  verifyComboFile,
} from '../../scripts/validate-combo-heldout.mjs';

const root = new URL('./trace-combo-heldout/', import.meta.url);
const readManifest = async () =>
  JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

test('both upstream channels have independent labels, not one union verdict', () => {
  assert.deepEqual(
    expectedComboChannels('combo_flash_patterns/30fps/001fb.csv'),
    { GENERAL_FLASH: true, RED_FLASH: true },
  );
  assert.deepEqual(
    expectedComboChannels('combo_flash_patterns/30fps/001fl.csv'),
    { GENERAL_FLASH: true, RED_FLASH: false },
  );
  assert.deepEqual(
    expectedComboChannels('combo_flash_patterns/30fps/001fr.csv'),
    { GENERAL_FLASH: false, RED_FLASH: true },
  );
  assert.deepEqual(
    expectedComboChannels('combo_flash_patterns/30fps/001p.csv'),
    { GENERAL_FLASH: false, RED_FLASH: false },
  );
  assert.throws(
    () => expectedComboChannels('combo_flash_patterns/30fps/003fb.csv'),
    /Unknown combo/,
  );
});

test('pre-scoring corpus bytes, all eight inputs and unseen blob identities verify without scoring', async () => {
  const result = await verifyComboCorpus();
  assert.equal(result.contents.size, 10);
  assert.equal(
    result.manifest.files.filter((file) => file.kind === 'COMBINED_GENERAL_RED')
      .length,
    8,
  );
});

test('relabelled, excluded and duplicated cases are rejected independently of hashes', async () => {
  const manifest = await readManifest();
  const relabelled = structuredClone(manifest);
  relabelled.files.find((file) =>
    file.path.endsWith('001fr.csv'),
  ).expectedChannels.GENERAL_FLASH = true;
  assert.throws(() => validateComboContract(relabelled), /suffix labels/);
  const excluded = structuredClone(manifest);
  excluded.files.pop();
  assert.throws(() => validateComboContract(excluded));
  const duplicate = structuredClone(manifest);
  duplicate.files[2] = duplicate.files[1];
  assert.throws(() => validateComboContract(duplicate), /Duplicate/);
});

test('truncated or changed source bytes cannot be accepted as an upstream input', async () => {
  const manifest = await readManifest();
  const file = manifest.files.find((file) => file.path.endsWith('001fb.csv'));
  const original = await readFile(new URL('upstream/' + file.path, root));
  assert.throws(
    () => verifyComboFile(file, original.subarray(0, original.length - 1)),
    /length mismatch/,
  );
  const changed = Buffer.from(original);
  changed[changed.length - 2] ^= 1;
  assert.throws(() => verifyComboFile(file, changed), /SHA-256 mismatch/);
});
