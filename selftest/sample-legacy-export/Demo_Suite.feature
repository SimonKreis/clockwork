@OracleHCM @Demo
Feature: Demo
@Demo1 @Demo1
Scenario: 1 Create a course_PROJ-1001
Given I navigate to "(URL)"
And I enter into input field "[UserId]" the value "(UserIdSpecialist)"
And I enter into input field "[Password]" the value "(Password)"
And I click on "[SignIn]" link
And I add wait seconds of "5"
And I click on "[Navigator]" link
And I add wait seconds of "2"
And I click on "[MyClientGroups]" link
And I add wait seconds of "3"
And I click on "[Learning]" link
And I add wait seconds of "5"
And I click on "[Courses]" link
And I add wait seconds of "3"
And I take screenshot
And I click on "[CreateButton]" link
And I add wait seconds of "3"
And I enter into input field "[Title]" the value "(title)"
And I add wait seconds of "2"
And I clear the content of input field "[StartDate]"
And I add wait seconds of "2"
And I enter into input field "[StartDate]" the value "(StartDate)"
And I add wait seconds of "2"
And I capture element "[CourseNumber]" as variable
And I add wait seconds of "2"
And I enter into input field "[Category]" the value "(category)"
And I add wait seconds of "3"
And I press tab key on "[Category]"
And I add wait seconds of "2"
#And I enter into input field "[Title]" the value "this step was switched off by its author"
And I click on "[SaveAndClose]" link
And I add wait seconds of "10"
And I take screenshot
@Demo2
Scenario: 2 Search and approve_PROJ-1002
Given I navigate to "(URL)"
And I enter into input field "[UserId]" the value "(UserIdEmployee)"
And I enter into input field "[Password]" the value "(Password)"
And I click on "[SignIn]" link
And I add wait seconds of "5"
And I capture return value as "request_ref" from custom code "GenerateRandomString" run with arguments
|"string"|
|"3"|
|"4"|
And I click on "[Navigator]" link
And I add wait seconds of "2"
And I enter into input field "[SearchBox]" the value "(searchTerm)"
And I add wait seconds of "5"
And I press enter key on "[SearchBox]"
And I add wait seconds of "8"
And I take screenshot
And I click on "[Settings_Actions_Img]" link
And I add wait seconds of "2"
And I click on "[Sign_out]" link
And I add wait seconds of "2"
And I click on "[SignOut_Confirm]" button
And I add wait seconds of "260"
Given I navigate to "(URL)"
And I enter into input field "[UserId]" the value "(UserIdApprover)"
And I enter into input field "[Password]" the value "(Password)"
And I click on "[SignIn]" button
And I add wait seconds of "3"
And I click on "[Notifications]" link
And I add wait seconds of "2"
And I switch to new window
And I add wait seconds of "5"
And I click on "[ApproveButton]" link
And I add wait seconds of "5"
And I close new window
And I switch to main window
And I take screenshot
@Demo4
Scenario: 4 Run depreciation_PROJ-1004
Given I navigate to "(URL)"
And I enter into input field "[UserId]" the value "(UserIdSpecialist)"
And I enter into input field "[Password]" the value "(Password)"
And I click on "[SignIn]" button
And I add wait seconds of "5"
And I click on "[Navigator]" link
And I add wait seconds of "2"
And I click on "[FixedAssets]" link
And I add wait seconds of "5"
And I select from dropdown "[BookType]" the value "(bookType)"
And I add wait seconds of "3"
And I select from list "[AssetCategory]" the value "(category)"
And I add wait seconds of "3"
And I double click on "[AssetRow]" button
And I add wait seconds of "2"
And I click on single key "VK_ENTER"
And I add wait seconds of "10"
And I refresh page
And I add wait seconds of "5"
And I switch to frame having xpath ".//iframe[contains(@id,'processDetails:')]"
And I add wait seconds of "3"
Then "[DepreciationSuccess]" should be present
And "[ProcessRowStatus]" should have partial text as "Succeeded"
And "[PeriodAccrual]" should have text as "(periodAccrual)"
And I should see page title as "Assets"
And I check if "[ClearFilter]" present
And I click on "[ClearFilter]" link
And I end conditional check
And I run visual button click on text "[SubmitImage]"
And I download file from "[ExportLink]"
And I hover over "[AssetRow]"
And I take screenshot
#@Demo3
#Scenario: 3 Disabled in legacy_PROJ-1003
#Given I navigate to "(URL)"
#And I enter into input field "[UserId]" the value "(UserIdSpecialist)"
#And I enter into input field "[Password]" the value "(Password)"
#And I click on "[SignIn]" link
#And I add wait seconds of "5"
#And I click on "[SomeObjectWithNoLocator]" link
#And I take screenshot

@Demo5
Scenario: 5 Reassign after a window switch_PROJ-1005
Given I navigate to "(URL)"
And I enter into input field "[UserId]" the value "(UserIdSpecialist)"
And I enter into input field "[Password]" the value "(Password)"
And I click on "[SignIn]" button
And I add wait seconds of "4"
And I click on "[Navigator]" link
And I click on "[Fixed Assets]" link
And I take screenshot
And I click on "[Adjust_Asset]" button
And I add wait seconds of "3"
And I switch to main window
And I enter into input field "[UserId]" the value "(UserIdApprover)"
And I enter into input field "[Password]" the value "(Password)"
And I click on "[SignIn]" button
And I add wait seconds of "3"
And I click on "[ApproveButton]" link
And I take screenshot
