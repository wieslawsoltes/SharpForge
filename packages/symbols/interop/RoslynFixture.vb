Imports System

Public Enum DeclarationOnly
    First
    Second
End Enum

Public Module Fixture
    Public Function Value(input As Integer) As Integer
        Const Answer As Integer = 42
        Dim pair As (left As Integer, right As String) = (Answer, "portable symbols")
        Console.WriteLine(pair.right)
        Return pair.left + input
    End Function
End Module
