export const quoteIdentifier = (value) =>
  '"' + value.replaceAll('"', '""') + '"';
export async function grantApplicationPrivileges(
  client,
  runtimeRole,
  backupRole,
) {
  if (!runtimeRole || !backupRole || runtimeRole === backupRole)
    throw new Error('Runtime dan backup memerlukan role berbeda.');
  const runtime = quoteIdentifier(runtimeRole),
    backup = quoteIdentifier(backupRole);
  await client.query('BEGIN');
  try {
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${runtime},${backup}`);
    await client.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${runtime},${backup}`,
    );
    await client.query(`GRANT SELECT ON "User" TO ${runtime}`);
    await client.query(
      `GRANT UPDATE ("passwordHash","lastLoginAt","updatedAt") ON "User" TO ${runtime}`,
    );
    await client.query(
      `GRANT SELECT,INSERT,UPDATE ON "AuthSession","Employee","ViolationType","FineCase","AppSettings" TO ${runtime}`,
    );
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON "EmployeeAlias","FineCaseMember" TO ${runtime}`,
    );
    await client.query(
      `GRANT SELECT,INSERT ON "PaymentEntry","AuditLog","FineCaseCreation" TO ${runtime}`,
    );
    await client.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${runtime}`,
    );
    await client.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${backup}`,
    );
    await client.query(
      `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${backup}`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
