-- Only dictionary SELECTs. Confirm schema/columns before executing remaining SQL.
-- Bind tenant_id and org_id from the actual PHIS reception context.
-- This is an audit export; it must NOT become a desktop cached order catalog.
SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS current_schema FROM dual;
SELECT owner, table_name, column_name, data_type
FROM all_tab_columns
WHERE table_name IN ('HI_BD_CLI', 'HI_BD_CLI_ORG', 'HI_BD_CLI_COM',
 'HI_CLI_LIS_CATEGORY', 'HI_CLI_LIS_CATEGORY_SUB', 'HI_CLI_LIS_GROUP',
 'HI_CLI_LIS_GROUP_SUB', 'HI_BD_CLI_PACS_PART', 'HI_INS_REF')
ORDER BY owner, table_name, column_id;

-- Active outpatient clinical items. sd_use: 1=outpatient, 2=inpatient, 3=both.
SELECT c.id_cli, c.cd_cli, c.na_cli, c.sd_cli, c.sd_use,
       c.fg_single, c.fg_combination, o.id_tet, o.id_org,
       o.id_dept_exec, o.price_sale
FROM hi_bd_cli c JOIN hi_bd_cli_org o ON o.id_cli = c.id_cli
WHERE c.fg_active = '1' AND o.fg_active = '1'
  AND c.sd_cli IN ('1', '2') AND c.sd_use IN ('1', '3')
  AND o.id_tet = :tenant_id AND o.id_org = :org_id
ORDER BY c.sd_cli, c.na_cli, c.id_cli;

-- LIS category binding: id_item may refer to a clinical item OR a LIS group.
SELECT a.id_lis_category, a.na_lis_category, a.sd_use, b.id_item,
       c.na_cli, c.fg_combination, c.fg_single, c.sd_use AS item_sd_use,
       g.na_group, g.sd_use AS group_sd_use
FROM hi_cli_lis_category a
JOIN hi_cli_lis_category_sub b ON b.id_lis_category = a.id_lis_category
LEFT JOIN hi_bd_cli c ON c.id_cli = b.id_item AND c.fg_active = '1'
LEFT JOIN hi_cli_lis_group g ON g.id_group = b.id_item
  AND g.id_tet = :tenant_id AND g.id_org = :org_id AND g.fg_active = '1'
WHERE a.id_tet = :tenant_id AND a.id_org = :org_id AND a.fg_active = '1'
  AND b.id_tet = :tenant_id AND b.id_org = :org_id
  AND a.sd_use IN ('1', '3')
ORDER BY a.na_lis_category, b.id_item;

-- LIS group composition; do not silently split a recommendation into orders.
SELECT g.id_group, g.na_group, g.sd_use, s.id_cli,
       c.na_cli, c.cd_cli, c.fg_active AS item_active
FROM hi_cli_lis_group g
JOIN hi_cli_lis_group_sub s ON s.id_group = g.id_group
LEFT JOIN hi_bd_cli c ON c.id_cli = s.id_cli
WHERE g.id_tet = :tenant_id AND g.id_org = :org_id AND g.fg_active = '1'
  AND g.sd_use IN ('1', '3')
  AND s.id_tet = :tenant_id AND s.id_org = :org_id
ORDER BY g.na_group, g.id_group, s.id_cli;

-- PACS body part and method are separate order identities.
SELECT p.id_part, p.id_cli, c.na_cli, p.na_part, p.na_way, p.na,
       p.id_org, p.id_org_pri, p.fg_pri, p.sd_pacstype
FROM hi_bd_cli_pacs_part p JOIN hi_bd_cli c ON c.id_cli = p.id_cli
WHERE p.fg_active = '1' AND c.fg_active = '1'
  AND c.sd_cli = '2' AND c.sd_use IN ('1', '3')
  AND p.id_tet = :tenant_id
  AND (p.id_org = :org_id OR p.id_org_pri = :org_id)
ORDER BY c.na_cli, p.na_part, p.na_way, p.id_part;

-- Insurance candidates only. Check effective date, insurance plan, private/global
-- scope and the exact referenced entity before joining id_his_pro to id_cli.
SELECT id_tet, id_org_pri, id_his_pro, na_his_pro, sd_his_pro,
       med_list_codg, na_ins_pro
FROM hi_ins_ref
WHERE id_tet = :tenant_id AND sd_his_pro = '2'
ORDER BY id_org_pri, na_his_pro, id_his_pro, med_list_codg;
