-- Removes the demo TRADER account and everything it owns (the admin account is kept): trades, goals, analyses,
-- notifications and settings all cascade from auth.users.
-- Uploaded files (if any) must be removed through the Storage API/dashboard:
-- Storage -> trade-screenshots / avatars -> delete the folder named after the user id.
delete from auth.users where email = 'demo.trader@example.com';
