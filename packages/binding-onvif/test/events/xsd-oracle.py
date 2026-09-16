import json
import sys

from lxml import etree

cases = json.load(sys.stdin)
result = []
namespace = "http://www.w3.org/2001/XMLSchema"
for case in cases:
    schema = etree.Element(f"{{{namespace}}}schema", nsmap={"xs": namespace})
    element = etree.SubElement(schema, f"{{{namespace}}}element", name="Value")
    simple = etree.SubElement(element, f"{{{namespace}}}simpleType")
    restriction = etree.SubElement(simple, f"{{{namespace}}}restriction", base=case["base"])
    etree.SubElement(restriction, f"{{{namespace}}}pattern", value=case["pattern"])
    validator = etree.XMLSchema(schema)
    values = []
    for value in case["values"]:
        document = etree.Element("Value")
        document.text = value
        values.append(validator.validate(document))
    result.append(values)
print(json.dumps(result))
