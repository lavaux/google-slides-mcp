# Element lookup spans layouts and masters

Layout and master shapes take the same edit requests as slide shapes. The shared element lookup now searches slides, layouts and masters, in that order. `Located` records which kind of page the element was found on. `set_shape_properties`, `set_text_style`, `set_element_text` and `set_element_geometry` therefore edit layout and master shapes with no change of their own. An edit there changes every slide that inherits from the page.

`list_page_elements` still lists slides by default, so its common output stays short. A layout or master is listed when its id is passed as `pageObjectId`, labelled with its `pageType`. `list_layouts` is how a caller finds those ids.

The fetch for a lookup now carries the elements of every layout and master, which a typical theme makes about ten pages larger. ADR-0014 already accepts unmasked `pageElements` for the sake of group depth, and this is the same trade: some latency, no hidden elements.
