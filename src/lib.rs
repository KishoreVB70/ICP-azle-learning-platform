#[macro_use]
extern crate serde;
use candid::{Decode, Encode};
use ic_cdk::api::time;
use std::sync::Mutex;
use ic_cdk::api;
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{BoundedStorable, Cell, DefaultMemoryImpl, StableBTreeMap, Storable};
use std::{borrow::Cow, cell::RefCell};

type Memory = VirtualMemory<DefaultMemoryImpl>;
type IdCell = Cell<u64, Memory>;

#[derive(candid::CandidType, Clone, Serialize, Deserialize, Default)]
struct Course {
    id: u64,
    creator_name: String,
    creator_address: String, // Stores the principal of the caller in string format
    title: String,
    body: String,
    attachment_url: String,
    keyword: String,
    category: String,
    contact: String,
    created_at: u64,
    updated_at: Option<u64>,
}

// a trait that must be implemented for a struct that is stored in a stable struct
impl Storable for Course {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        Cow::Owned(Encode!(self).unwrap())
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Self).unwrap()
    }
}

// another trait that must be implemented for a struct that is stored in a stable struct
impl BoundedStorable for Course {
    const MAX_SIZE: u32 = 1024;
    const IS_FIXED_SIZE: bool = false;
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(
        MemoryManager::init(DefaultMemoryImpl::default())
    );

    static ID_COUNTER: RefCell<IdCell> = RefCell::new(
        IdCell::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))), 0)
            .expect("Cannot create a counter")
    );

    static STORAGE: RefCell<StableBTreeMap<u64, Course, Memory>> =
        RefCell::new(StableBTreeMap::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1)))
    ));

    // Stores a single admin address
    static ADMIN_ADDRESS: Mutex<Option<String>> = Mutex::new(None);

    // Stores the moderator addresses
    static MODERATOR_ADDRESSES: Mutex<Vec<String>> = Mutex::new(Vec::new());

    // Satores teh addresses of banned users
    static BANNED_ADDRESSES: Mutex<Vec<String>> = Mutex::new(Vec::new());
}

//Payload to add a new course obtained from the user
#[derive(candid::CandidType, Serialize, Deserialize, Default)]
struct CoursePayLoad {
    title: String,
    creator_name: String,
    body: String,
    attachment_url: String,
    keyword: String,
    category: String,
    contact: String,
}

//Payload to update a  course obtained from the user
#[derive(candid::CandidType, Serialize, Deserialize, Default)]
struct CourseUpdatePayLoad {
    title: Option<String>,
    creator_name: Option<String>,
    body: Option<String>,
    attachment_url: Option<String>,
    keyword: Option<String>,
    category: Option<String>,
    contact: Option<String>,
}

// Payload to filter all the available courses
#[derive(candid::CandidType, Serialize, Deserialize, Default)]
struct FilterPayLoad {
    keyword: Option<String>,
    category: Option<String>,
    creator_address: Option<String>,
}

// Function to set the admin
// If the admin is not already set, the address input is set the admin,
// If the admin is initialized, then only the current admin can change the admin
#[ic_cdk::update]
fn set_admin_address(address: String) -> Result<(), Error> {
    let caller: String = api::caller().to_string();
    ADMIN_ADDRESS.with(|admin_address| {
        let mut admin = admin_address.lock().unwrap();

        // If admin address is not set, or the caller is the current admin
        if admin.is_none() || admin.as_ref().unwrap() == &caller {
            *admin = Some(address);
            Ok(())
        } else {
            Err(Error:: UnAuthorized {
                msg: ("Only admin can change".to_string())
            })
        }
    })
}

// Adds a moderator. Only the admin can add moderators.
#[ic_cdk::update]
fn add_moderator(address: String) -> Result<(), String> {
    // Get the caller's principal
    let caller = api::caller().to_string();

    // Check if admin address is set and if caller is admin
    let is_admin = _is_admin(caller);

    if is_admin {
        let result = MODERATOR_ADDRESSES.with(|moderator_addresses| {
            let mut addresses = moderator_addresses.lock().unwrap();
            
            // Check if the maximum number of moderators is reached
            if addresses.len() >= 5 {
                return Err("Maximum number of moderators reached".to_string())
            }
    
            // Check if the moderator address already exists
            if addresses.contains(&address) {
                return Err("Moderator address already exists".to_string())
            }

            addresses.push(address);
            Ok(())
        });
        result
    } else {
        Err("Only admin can add moderators".to_string())
    }
}

// Removes a moderator. Only admin can remove moderators.
#[ic_cdk::update]
fn remove_moderator(address: String) -> Result<(), Error> {
    // Get the caller's principal
    let caller = api::caller().to_string();

    // Check if the caller is admin
    let is_admin: bool = _is_admin(caller);

    if is_admin {
        MODERATOR_ADDRESSES.with(|moderator_addresses| {
            let mut addresses = moderator_addresses.lock().unwrap();
            // Check if the moderator address exists
            if addresses.contains(&address) {
                addresses.retain(|a| a != &address);
                Ok(())
            } else {
                Err(Error::NotFound {
                    msg: ("Provided addres is not a moderator".to_string())
                })
            }
        })
    } else {
        Err(Error::UnAuthorized {
            msg: ("only admin can remove moderators".to_string())
        })
    }
}

// Retrieves a course based on its ID.
#[ic_cdk::query]
fn get_course(id: u64) -> Result<Course, Error> {
    match _get_course_(&id) {
        Some(course) => Ok(course),
        None => Err(Error::NotFound {
            msg: format!("a course with id={} not found", id),
        }),
    }
}

// Filters courses based on the provided criteria (AND condition)
// The AND condition is such that it retreives the courses which satisfy all the
// criteria provided by the user
#[ic_cdk::query]
fn filter_courses_and(payload: FilterPayLoad) -> Result<Vec<Course>, Error> {
    // Check if the FilterPayLoad is empty
    if payload.keyword.is_none() && payload.category.is_none() && payload.creator_address.is_none() {
        return Err(Error::NotFound {
            msg: "Filter payload is empty; at least one filter criterion must be provided".to_string(),
        });
    }

    let courses: Vec<Course> = STORAGE.with(|storage| {
        storage.borrow().iter()
            .filter_map(|(_, course)| {
                let mut matches = true;
                if let Some(ref keyword) = payload.keyword {
                    matches &= course.keyword == *keyword;
                }
                if let Some(ref category) = payload.category {
                    matches &= course.category == *category;
                }
                if let Some(ref creator_address) = payload.creator_address {
                    matches &= course.creator_address == *creator_address;
                }
                if matches {
                    Some(course.clone())
                } else {
                    None
                }
            })
            .collect()
    });

    if courses.is_empty() {
        Err(Error::NotFound{
            msg: (
                "couldn't find a course with provided inputs".to_string()
            ),
        })
    } else {
        Ok(courses)
    }
}

// Filters courses based on the provided criteria (OR condition).
// The OR condition is such that it retreives the courses which satisfy any of the
// criteria provided by the user
#[ic_cdk::query]
fn filter_courses_or(payload: FilterPayLoad) -> Result<Vec<Course>, Error> {
    // Check if the FilterPayLoad is empty
    if payload.keyword.is_none() && payload.category.is_none() && payload.creator_address.is_none() {
        return Err(Error::NotFound {
            msg: "Filter payload is empty; at least one filter criterion must be provided".to_string(),
        });
    }
    let courses: Vec<Course> = STORAGE.with(|storage| {
        storage.borrow().iter()
            .filter_map(|(_, course)| {
                let mut matches = false;
                if let Some(ref keyword) = payload.keyword {
                    matches |= course.keyword == *keyword; 
                }
                if let Some(ref category) = payload.category {
                    matches |= course.category == *category; 
                }
                if let Some(ref creator_address) = payload.creator_address {
                    matches |= course.creator_address == *creator_address; 
                }
                if matches {
                    Some(course.clone())
                } else {
                    None
                }
            })
            .collect()
    });

    if courses.is_empty() {
        Err(Error::NotFound{
            msg: (
                "couldn't find a course with provided inputs".to_string()
            ),
        })
    } else {
        Ok(courses)
    }
}

// Adds a new course to the storage
#[ic_cdk::update]
fn add_course(course: CoursePayLoad) -> Result<Course, Error> {
    let address_string: String = api::caller().to_string();
    // Check whether the user is banned
    BANNED_ADDRESSES.with(|banned_addresses| {
        let addresses = banned_addresses.lock().unwrap();
        if addresses.contains(&address_string) {
            return Err(Error::BannedUser {
                msg: "User is banned. Cannot add course".to_string(),
            });
        } else {
            //Validation Logic
            if course.title.is_empty()
            || course.creator_name.is_empty()
            || course.body.is_empty()
            || course.attachment_url.is_empty()
            || course.keyword.is_empty()
            || course.category.is_empty()
            || course.contact.is_empty()
            {
                return Err(Error::EmptyFields {
                    msg: "Please fill in all the required fields to create a course".to_string(),
                });
            }
            let id = ID_COUNTER
                .with(|counter| {
                    let current_value = *counter.borrow().get();
                    counter.borrow_mut().set(current_value + 1)
                })
                .expect("cannot increment id counter");
        
            let course = Course {
                id,
                creator_address: address_string,
                creator_name: course.creator_name,
                title: course.title,
                body: course.body,
                attachment_url: course.attachment_url,
                created_at: time(),
                updated_at: None,
                category: course.category,
                keyword: course.keyword,
                contact: course.contact
            };
            do_insert(&course);
            Ok(course)
        }
    })
}

// Updates an existing course. Only the creator or the admin or a moderator can update
#[ic_cdk::update]
fn update_course(id: u64, payload: CourseUpdatePayLoad) -> Result<Course, Error> {
    match STORAGE.with(|service| service.borrow().get(&id)) {
        Some(mut course) => {
            let caller = api::caller().to_string();
            let is_allowed = _is_allowed(id, caller);
            if is_allowed {
                if let Some(title) = payload.title {
                    course.title = title;
                }
                if let Some(creator_name) = payload.creator_name {
                    course.creator_name = creator_name;
                }
                if let Some(body) = payload.body {
                    course.body = body;
                }
                if let Some(attachment_url) = payload.attachment_url {
                    course.attachment_url = attachment_url;
                }
                if let Some(keyword) = payload.keyword {
                    course.keyword = keyword;
                }
                if let Some(category) = payload.category {
                    course.category = category;
                }
                if let Some(contact) = payload.contact {
                    course.contact = contact;
                }
                course.updated_at = Some(time());
                do_insert(&course);
                Ok(course)
            }else {
                Err(Error::UnAuthorized {
                    msg: format!("You are not authorized to update course with id={}", id),
                })
            }
        }
        None => Err(Error::NotFound {
            msg: format!(
                "couldn't update a course with id={}. course not found",
                id
            ),
        }),
    }
}

// Deletes a course based on the ID. Only the creator or the admin or a moderator can update
#[ic_cdk::update]
fn delete_course(id: u64) -> Result<Course, Error> {
    match STORAGE.with(|service| service.borrow().get(&id)) {
        Some(course) => {
            let caller = api::caller().to_string();

            // Checks if the caller is either the creator, or the admin or a moderator
            let is_allowed = _is_allowed(id, caller);

            // Remove the course from storage
            if is_allowed {
                STORAGE.with(|service| service.borrow_mut().remove(&id));
                Ok(course)
            } else {
                Err(Error::UnAuthorized {
                    msg: format!("You are not authorized to update course with id={}", id),
                })
            }
        }
        None => Err(Error::NotFound {
            msg: format!(
                "couldn't update a course with id={}. course not found",
                id
            ),
        }),
    }
}

// Deletes all courses by a creator based on the address. Only the admin or a moderator can access
#[ic_cdk::update]
fn delete_courses_by_creator(address: String) -> Result<Vec<Course>, Error> {
    let caller = api::caller().to_string(); // Convert caller address to string
    let is_allowed = {
        // Check if the caller is the input address
        if address == caller.to_string() {
            true
        } else {
            // Check if the caller is the admin
            let admin_address = ADMIN_ADDRESS.with(|admin_address| {
                admin_address.lock().unwrap().clone()
            });
            if let Some(admin) = &admin_address {
                if caller == *admin {
                    true
                } else {
                    // Check if the caller is one of the moderators
                    let moderators = MODERATOR_ADDRESSES.with(|moderator_addresses| {
                        moderator_addresses.lock().unwrap().clone()
                    });
                    moderators.contains(&caller.to_string())
                }
            } else {
                false
            }
        }
    };
    if is_allowed {
        let mut deleted_courses: Vec<Course> = Vec::new(); // Keep track of deleted courses
        STORAGE.with(|service| {
            let mut storage = service.borrow_mut();
            let mut keys_to_remove = Vec::new(); // Keep track of keys to remove
            // Iterate through storage to find and remove matching courses
            for (id, course) in storage.iter() {
                if course.creator_address == address {
                    // If creator address matches caller, mark for removal
                    keys_to_remove.push(id.clone());
                    deleted_courses.push(course.clone()); // Add course to deleted list
                }
            }
            // Remove courses from storage
            for key in keys_to_remove {
                storage.remove(&key);
            }
        });
        if deleted_courses.is_empty() {
            Err(Error::NotFound {
                msg: "No courses found for the caller. Nothing to delete.".to_string(),
            })
        } else {
            Ok(deleted_courses)
        }
    } else {
        Err(Error::UnAuthorized {
            msg: ("You are not authorized to delete the course ".to_string()),
        })
    }
}

// Deletes all courses of the caller
#[ic_cdk::update]
fn delete_my_courses() -> Result<Vec<Course>, Error> {
    let caller = api::caller().to_string(); // Convert caller address to string
    let mut deleted_courses: Vec<Course> = Vec::new(); // Keep track of deleted courses

    STORAGE.with(|service| {
        let mut storage = service.borrow_mut();
        let mut keys_to_remove = Vec::new(); // Keep track of keys to remove

        // Iterate through storage to find and remove matching courses
        for (id, course) in storage.iter() {
            if course.creator_address == caller {
                // If creator address matches caller, mark for removal
                keys_to_remove.push(id.clone());
                deleted_courses.push(course.clone()); // Add course to deleted list
            }
        }

        // Remove courses from storage
        for key in keys_to_remove {
            storage.remove(&key);
        }
    });

    if deleted_courses.is_empty() {
        Err(Error::NotFound {
            msg: "No courses found for the caller. Nothing to delete.".to_string(),
        })
    } else {
        Ok(deleted_courses)
    }
}

// Bans a creator from adding courses.
// Deletes all the courses by the creator
// Only the admin or a moderator can access
#[ic_cdk::update]
fn ban_creator(address: String) -> Result<Vec<Course>, Error> {
    // The caller must be admin or moderator
    let caller = api::caller().to_string(); // Convert caller address to string

    // Check if the caller is an admin or moderator
    let is_authorized: bool = _is_authorized(caller);

    // Checks if the the input address is admin or a moderator
    let is_allowed = {
        let admin_address = ADMIN_ADDRESS.with(|admin_address| {
            admin_address.lock().unwrap().clone()
        });
        if let Some(admin) = &admin_address{
            if address == *admin{
                false
            } else {
                // Check if the caller is one of the moderators
                let moderators = MODERATOR_ADDRESSES.with(|moderator_addresses| {
                    moderator_addresses.lock().unwrap().clone()
                });
                if moderators.contains(&address.to_string()) {
                    false
                } else {
                    true
                }
            }
        } else {
            false
        }
    };

    if is_allowed && is_authorized {
        // Delete all the courses of the user
        match delete_courses_by_creator(address.clone()){
            Ok(course) => {
                //Add the address to banned list
                BANNED_ADDRESSES.with(|banned_addresses| {
                    let mut addresses = banned_addresses.lock().unwrap();
                    addresses.push(address);
                });
                Ok(course)
            }
            Err(_) => Err(Error::NotFound {
                msg: ("No courses found for the address, cannot ban the user".to_string()),
            }),
        }
    } else {
        Err(Error::UnAuthorized {
            msg: ("You are not authorized to ban the user".to_string()),
        })
    }
}

// Un ban a creator from adding courses
// Only the admin or a moderator can access
#[ic_cdk::update]
fn un_ban_creator(address: String) -> Result<(), Error> {
    // The caller must be admin or moderator
    let caller = api::caller().to_string(); // Convert caller address to string

    // cheks if the caller is the admin or a moderator
    let is_authorized: bool = _is_authorized(caller);

    if is_authorized {
        BANNED_ADDRESSES.with(|banned_addresses| {
            let mut addresses = banned_addresses.lock().unwrap();
            if let Some(pos) = addresses.iter().position(|x| *x == address) {
                addresses.remove(pos);
                Ok(())
            } else {
                Err(Error::NotFound {
                    msg: "Address not found in banned list.".to_string(),
                })
            }
        })
    } else {
        Err(Error::UnAuthorized {
            msg: ("You are not authorized to ban the user".to_string()),
        })
    }
}

// Internal helper functions

//Retreive the course from storage
fn _get_course_(id: &u64) -> Option<Course> {
    STORAGE.with(|service| service.borrow().get(id))
}

// Add the course into the storage
fn do_insert(course: &Course) {
    STORAGE.with(|service| service.borrow_mut().insert(course.id, course.clone()));
}

// Checks if the address is the admin
fn _is_admin(address: String) -> bool {
    let admin_address = ADMIN_ADDRESS.with(|admin_address| {
        admin_address.lock().unwrap().clone()
    });

    if let Some(admin) = &admin_address {
        if address == *admin {
            true
        } else {
            false
        }
    } else {
        false
    }
}

// Checks if the caller is either the admin or a moderator
fn _is_authorized(address: String) -> bool {
    let admin_address = ADMIN_ADDRESS.with(|admin_address| {
        admin_address.lock().unwrap().clone()
    });
    if let Some(admin) = &admin_address {
        if address == *admin {
            true
        } else {
            // Check if the caller is one of the moderators
            let moderators = MODERATOR_ADDRESSES.with(|moderator_addresses| {
                moderator_addresses.lock().unwrap().clone()
            });
            moderators.contains(&address.to_string())
        }
    } else {
        false
    }
}

// Checks if the caller is either the creator of the id, or the admin or a moderator
fn _is_allowed(id: u64, caller: String) -> bool {
    let course = STORAGE.with(|service| service.borrow().get(&id));
    // Check if the caller is the creator of the course
    if course.unwrap().creator_address == caller.to_string() {
        true
    } else {
        // Check if the caller is the admin
        let admin_address = ADMIN_ADDRESS.with(|admin_address| {
            admin_address.lock().unwrap().clone()
        });
        if let Some(admin) = &admin_address {
            if caller == *admin {
                true
            } else {
                // Check if the caller is one of the moderators
                let moderators = MODERATOR_ADDRESSES.with(|moderator_addresses| {
                    moderator_addresses.lock().unwrap().clone()
                });
                moderators.contains(&caller.to_string())
            }
        } else {
            false
        }
    }
}

// Error types
#[derive(candid::CandidType, Deserialize, Serialize)]
enum Error {
    NotFound { msg: String },
    UnAuthorized { msg: String },
    EmptyFields {msg: String},
    BannedUser {msg: String}
}

// need this to generate candid
ic_cdk::export_candid!();