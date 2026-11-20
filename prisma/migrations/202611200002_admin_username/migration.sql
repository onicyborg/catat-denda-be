ALTER TABLE "User" ALTER COLUMN email DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN username VARCHAR(40);
CREATE UNIQUE INDEX "User_username_key" ON "User" (username);
ALTER TABLE "User" ADD CONSTRAINT "User_login_identity" CHECK (email IS NOT NULL OR username IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_username_format" CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');
