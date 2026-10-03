class Strings
{
    object[] values =
    {
        "", "plain", "tab\there", "quote\"inside", "back\\slash", "nul\0", "bell\a\b\f\n\r\t\v", "esc\e",
        "\u0041\u00e9\u4e2d", "\U0001F600\U00000041", "\x41\x042\x0043\x00044", "\x9\xAg",
        @"", @"verbatim \n no escapes", @"doubled ""quotes"" here", @"multi
line", "café 😀",
        'a', '\'', '\\', '\n', '\0', '\u0041', '\x41', '"', 'é',
        "utf8"u8, "héllo"U8, @"verbatim"u8, """raw"""u8, "\x7F\u0080\u07FF\u0800\U00010000"u8
    };
}
