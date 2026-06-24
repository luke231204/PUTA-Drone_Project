-- SQL schema for initializing the permits table in Supabase
-- Run this in the Supabase SQL Editor

-- Enable PostGIS if you want to support spatial queries natively later
-- create extension if not exists postgis;

create table if not exists permits (
  permit_id text,
  operator_name text not null,
  location text,
  year integer,
  date_start date,
  date_end date,
  time_start text,
  time_end text,
  max_altitude_ft integer,
  coordinates jsonb, -- stores polygon array of [lat, lng] coordinates
  pilot_name text[],
  puta_registry text[],
  file_name text,
  markdown_content text, -- stores full parsed/OCR text for search indexing
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (permit_id, file_name)
);

-- Indexing for performance
create index if not exists permits_operator_name_idx on permits(operator_name);
create index if not exists permits_year_idx on permits(year);
create index if not exists permits_date_start_idx on permits(date_start);
create index if not exists permits_date_end_idx on permits(date_end);
