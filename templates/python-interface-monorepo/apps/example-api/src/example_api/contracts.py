from oa_interface_contracts import ContractRegistry

from .models import CreateUser, User

registry = ContractRegistry(name="Example Users API", version="1.0.0")
registry.bearer_security_scheme(
    "BearerAuth",
    bearer_format="JWT",
    description="JWT bearer token.",
)
registry.model("CreateUser", CreateUser)
registry.model("User", User)
