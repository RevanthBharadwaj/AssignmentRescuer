import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { SqlJsDriver } from '../src/db/sqljsDriver';
import { Repository } from '../src/db/repository';
import { AcademicService } from '../src/core/service';

export const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
export const fixtureBytes = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

export async function makeService(bytes?: Uint8Array) {
  const SQL = await initSqlJs();
  const driver = await SqlJsDriver.create(SQL, bytes);
  const repo = new Repository(driver);
  const service = new AcademicService(repo);
  await service.init();
  return { SQL, driver, repo, service };
}

export async function approveAll(service: AcademicService) {
  for (const p of await service.repository.listProposals('pending')) await service.approve(p.id);
}
