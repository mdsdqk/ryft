/**
 * A read-only DDL view of one table — `CREATE TABLE …` plus its indexes and
 * constraints, the shape a backend engineer reads fastest (usability review
 * F4). Rendered by diffing an empty schema against a document holding just this
 * table, then serialising the statements without the migration's
 * BEGIN/COMMIT wrapper.
 *
 * Foreign keys that point at *other* tables are left out — this view is one
 * table in isolation — and a trailing comment says how many were omitted.
 */

import { useMemo } from "react";

import type { SchemaDocument, Table } from "@engine/schema.js";
import { emitMigration, serialize } from "@engine/emit.js";

function buildDdl(table: Table): { sql: string; omittedFks: number } {
  const selfFks = table.foreignKeys.filter((fk) => fk.refTableId === table.id);
  const omittedFks = table.foreignKeys.length - selfFks.length;
  const isolated: Table = { ...table, foreignKeys: selfFks };
  const empty: SchemaDocument = { database: "schema", tables: [] };
  const one: SchemaDocument = { database: "schema", tables: [isolated] };
  const { statements } = emitMigration(empty, one);
  return { sql: statements.map(serialize).join("\n"), omittedFks };
}

export function TableDdl({ table }: { table: Table }) {
  const result = useMemo(() => {
    try {
      return buildDdl(table);
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Could not render this table as SQL.",
      };
    }
  }, [table]);

  if ("error" in result) {
    return (
      <div className="bw-ddl bw-ddl--error" role="note">
        {result.error}
      </div>
    );
  }

  return (
    <pre
      className="bw-ddl"
      tabIndex={0}
      aria-label={`CREATE TABLE for ${table.name}, read-only`}
    >
      <code>
        {result.sql}
        {result.omittedFks > 0 && (
          <span className="bw-ddl__note">
            {"\n\n"}-- {result.omittedFks} foreign key
            {result.omittedFks === 1 ? "" : "s"} to other tables not shown
          </span>
        )}
      </code>
    </pre>
  );
}
