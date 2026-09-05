import jsonschema
from fib_service.config_loader import load_extraction_config
from fib_service.contracts.extraction_request_schema import Item, Page, Source
from fib_service.prompt_compiler import compile_messages, compile_schema


def test_compile_schema_main_group_validates_and_has_every_description() -> None:
    config = load_extraction_config("fixtureDeal")

    schema = compile_schema(config, "main")

    jsonschema.Draft202012Validator.check_schema(schema)
    assert schema["type"] == "object"
    for field in config.fields:
        prop = schema["properties"][field.fieldId]
        assert prop["description"] == field.description


def test_compile_schema_group_is_array_of_row_objects() -> None:
    config = load_extraction_config("fixtureDeal")

    schema = compile_schema(config, "parties")

    jsonschema.Draft202012Validator.check_schema(schema)
    assert schema["type"] == "array"
    row_properties = schema["items"]["properties"]
    for field in config.groups[0].fields:
        assert row_properties[field.fieldId]["description"] == field.description


def test_compile_messages_formats_pages_and_items() -> None:
    schema = {"title": "Ignored"}
    source = Source(
        sourceId="src1",
        pages=[
            Page(mergedPage=3, items=[Item(id="p3i17", text="Goldman Sachs Incorporated")]),
            Page(mergedPage=4, items=[Item(id="p4i1", text="Second page text")]),
        ],
    )

    messages = compile_messages(schema, source)

    assert messages[0]["role"] == "system"
    assert "cite" in messages[0]["content"].lower()
    user_content = messages[1]["content"]
    assert "## Page 3" in user_content
    assert "[p3i17] Goldman Sachs Incorporated" in user_content
    assert "## Page 4" in user_content
    assert "[p4i1] Second page text" in user_content
