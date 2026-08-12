import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `sessions.engine` — an optional per-session engine override. NULL preserves the historical
 * behavior where the deployment-wide ENGINE_TYPE decides which adapter a session uses.
 */
export class AddSessionEngine1786100000000 implements MigrationInterface {
  name = 'AddSessionEngine1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('sessions', 'engine')) return;
    await queryRunner.query(`ALTER TABLE "sessions" ADD COLUMN "engine" varchar(50)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('sessions', 'engine'))) return;
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "engine"`);
  }
}
