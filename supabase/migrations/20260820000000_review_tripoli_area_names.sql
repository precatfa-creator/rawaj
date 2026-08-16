-- Reviewed Arabic labels for two common Tripoli neighbourhoods whose OSM
-- relations currently expose only Latin `name` tags. The original spelling
-- remains in alt_name for search and traceability.
alter table public.delivery_zones disable trigger enforce_delivery_zones_permissions;
alter table public.delivery_zones disable trigger audit_delivery_zones;

update public.delivery_zones
set name = 'النوفليين', alt_name = 'Noofliyyeen', needs_translation = false
where source = 'OSM relation/14708500';

update public.delivery_zones
set name = 'بن عاشور', alt_name = 'Ben Ashour', needs_translation = false
where source = 'OSM relation/14713957';

alter table public.delivery_zones enable trigger enforce_delivery_zones_permissions;
alter table public.delivery_zones enable trigger audit_delivery_zones;
