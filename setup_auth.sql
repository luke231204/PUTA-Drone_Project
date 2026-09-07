-- ============================================================================
-- PUTA-MONITOR AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC) SETUP
-- Run this script in the Supabase SQL Editor for your project.
-- ============================================================================

-- 1. Create User Role Enum (safely check if it exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('regular', 'inspector', 'dev');
  END IF;
END
$$;

-- 2. Create Profiles Table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email text NOT NULL,
  role public.user_role DEFAULT 'regular'::public.user_role NOT NULL,
  approved boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security on Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Allow read profiles for authenticated users" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow Devs to update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'dev'::public.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'dev'::public.user_role
    )
  );

-- 3. Trigger Function to Handle Profile Creation on Sign Up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  is_first_user boolean;
  assigned_role public.user_role;
  is_approved boolean;
BEGIN
  -- Automatically bootstrap the first user as Dev
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first_user;
  
  IF is_first_user THEN
    assigned_role := 'dev'::public.user_role;
    is_approved := true;
  ELSE
    assigned_role := COALESCE((new.raw_user_meta_data->>'role')::public.user_role, 'regular'::public.user_role);
    -- Block malicious attempts to sign up directly as Dev
    IF assigned_role = 'dev' THEN
      assigned_role := 'regular'::public.user_role;
    END IF;
    
    -- Inspectors need admin approval, regular users are auto-approved
    is_approved := CASE 
      WHEN assigned_role = 'inspector' THEN false
      ELSE true
    END;
  END IF;

  INSERT INTO public.profiles (id, email, role, approved)
  VALUES (
    new.id,
    new.email,
    assigned_role,
    is_approved
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate Trigger (drop first to prevent duplicate trigger errors)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES FOR PERMITS TABLE
-- ============================================================================

-- Enable RLS on permits
ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;

-- Allow read access for any authenticated session
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.permits;
CREATE POLICY "Allow select for authenticated users" ON public.permits
  FOR SELECT TO authenticated USING (true);

-- Allow insert/update/delete (Write) ONLY for approved Inspectors and Devs
DROP POLICY IF EXISTS "Allow write for approved inspectors and devs" ON public.permits;
CREATE POLICY "Allow write for approved inspectors and devs" ON public.permits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.approved = true
      AND profiles.role IN ('inspector'::public.user_role, 'dev'::public.user_role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.approved = true
      AND profiles.role IN ('inspector'::public.user_role, 'dev'::public.user_role)
    )
  );


-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES FOR PERMIT STORAGE BUCKET (storage.objects)
-- ============================================================================

-- Allow public read/download access to PDFs in 'permit-pdfs' bucket
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
CREATE POLICY "Allow public read access" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'permit-pdfs');

-- Allow uploads ONLY for approved Inspectors and Devs
DROP POLICY IF EXISTS "Allow uploads for approved inspectors and devs" ON storage.objects;
CREATE POLICY "Allow uploads for approved inspectors and devs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'permit-pdfs'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.approved = true
      AND profiles.role IN ('inspector'::public.user_role, 'dev'::public.user_role)
    )
  );

-- Allow deletions ONLY for Devs (to enforce cleanup protection)
DROP POLICY IF EXISTS "Allow deletions only for devs" ON storage.objects;
CREATE POLICY "Allow deletions only for devs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'permit-pdfs'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.approved = true
      AND profiles.role = 'dev'::public.user_role
    )
  );
