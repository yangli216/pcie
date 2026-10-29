-- Only dictionary SELECTs. Run in the confirmed on-site CDW schema.
-- First confirm table owner, column definitions and current tenant; no clinical data.
SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS current_schema FROM dual;
SELECT owner, table_name, column_name, data_type
FROM all_tab_columns
WHERE table_name IN ('MBYT_LP_CONTRAST', 'MBYT_LPACS_STANDARD')
ORDER BY owner, table_name, column_id;

SELECT id_tet, COUNT(*) AS row_count
FROM MBYT_LP_CONTRAST
GROUP BY id_tet ORDER BY id_tet;

-- Bind the actual tenant; never infer it from an unrelated test configuration.
SELECT id, id_tet, na_lp, na_cl_lp, cd_cli, sn
FROM MBYT_LP_CONTRAST
WHERE id_tet = :tenant_id
ORDER BY sn, id;

-- Confirmed TESTMB schema has no CD_YB column. Do not assume newer seed SQL is deployed.
SELECT id, fg_sets, sd_type, cd_item, na_item,
       sd_source, sd_frequency, des_info
FROM MBYT_LPACS_STANDARD
ORDER BY id;
